package com.wife.server.websocket;

import com.wife.server.config.DoubaoConfig;
import com.wife.server.config.SecurityConfig;
import com.wife.server.service.RateLimitService;
import com.wife.server.util.AesUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;

@Component
public class DoubaoProxyHandler extends AbstractWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(DoubaoProxyHandler.class);

    private static final ObjectMapper mapper = new ObjectMapper();

    private final DoubaoConfig doubaoConfig;
    private final RateLimitService rateLimitService;
    private final SecurityConfig securityConfig;

    // 每个客户端session对应一个豆包upstream连接
    private final Map<String, WebSocketClient> upstreamMap = new java.util.concurrent.ConcurrentHashMap<>();

    public DoubaoProxyHandler(DoubaoConfig doubaoConfig, RateLimitService rateLimitService, SecurityConfig securityConfig) {
        this.doubaoConfig = doubaoConfig;
        this.rateLimitService = rateLimitService;
        this.securityConfig = securityConfig;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String ip = getClientIp(session);
        String deviceId = getDeviceId(session);

        log.info("[代理] 新客户端连接 ip={}, deviceId={}", ip, deviceId);

        // token校验
        String token = getQueryParam(session, "token");
        if (!validateWsToken(token)) {
            log.warn("[代理] token校验失败 ip={}", ip);
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        // 限流检查
        if (!rateLimitService.checkAndIncrement(ip, deviceId)) {
            log.warn("[代理] 限流拒绝 ip={}, deviceId={}", ip, deviceId);
            session.sendMessage(new TextMessage("{\"type\":\"blocked\",\"reason\":\"rate_limit\"}"));
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        // 建立到豆包的upstream连接
        connectUpstream(session);
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        WebSocketClient upstream = upstreamMap.get(session.getId());
        if (upstream != null && upstream.isOpen()) {
            upstream.send(message.getPayload());
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // 前端不应发文本帧，忽略
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        log.info("[代理] 客户端断开 sessionId={}", session.getId());
        WebSocketClient upstream = upstreamMap.remove(session.getId());
        if (upstream != null && !upstream.isClosed()) {
            upstream.close();
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        log.error("[代理] 传输错误 sessionId={}", session.getId(), exception);
        WebSocketClient upstream = upstreamMap.remove(session.getId());
        if (upstream != null && !upstream.isClosed()) {
            upstream.close();
        }
    }

    private void connectUpstream(WebSocketSession clientSession) throws Exception {
        String connectId = UUID.randomUUID().toString();

        Map<String, String> headers = new HashMap<>();
        headers.put("X-Api-App-Key", doubaoConfig.getAppKey());
        headers.put("X-Api-Access-Key", doubaoConfig.getAccessToken());
        headers.put("X-Api-Resource-Id", doubaoConfig.getResourceId());
        headers.put("X-Api-Request-Id", connectId);
        headers.put("Authorization", "Bearer;" + doubaoConfig.getAccessToken());
        headers.put("X-Api-App-Id", doubaoConfig.getAppId());

        URI uri = new URI(doubaoConfig.getUrl());

        // 缓冲客户端在upstream就绪前发来的消息
        ConcurrentLinkedQueue<ByteBuffer> pendingMessages = new ConcurrentLinkedQueue<>();

        WebSocketClient upstream = new WebSocketClient(uri, headers) {
            private volatile boolean ready = false;

            @Override
            public void onOpen(ServerHandshake handshake) {
                log.info("[代理] → 豆包连接成功 connectId={}", connectId);
                ready = true;
                // 发送缓冲的消息
                ByteBuffer msg;
                while ((msg = pendingMessages.poll()) != null) {
                    this.send(msg);
                }
            }

            @Override
            public void onMessage(String message) {
                // 豆包不发文本帧，忽略
            }

            @Override
            public void onMessage(ByteBuffer bytes) {
                try {
                    if (clientSession.isOpen()) {
                        clientSession.sendMessage(new BinaryMessage(bytes));
                    }
                } catch (Exception e) {
                    log.error("[代理] 发送到客户端失败", e);
                }
            }

            @Override
            public void onClose(int code, String reason, boolean remote) {
                log.info("[代理] 豆包断开 code={}, remote={}", code, remote);
                try {
                    if (clientSession.isOpen()) {
                        clientSession.close();
                    }
                } catch (Exception e) {
                    log.error("[代理] 关闭客户端失败", e);
                }
            }

            @Override
            public void onError(Exception ex) {
                log.error("[代理] 豆包连接错误", ex);
                try {
                    if (clientSession.isOpen()) {
                        clientSession.close();
                    }
                } catch (Exception e) {
                    log.error("[代理] 关闭客户端失败", e);
                }
            }
        };

        upstreamMap.put(clientSession.getId(), upstream);
        upstream.connectBlocking();
    }

    private String getClientIp(WebSocketSession session) {
        // 尝试从 X-Forwarded-For 获取真实IP
        var headers = session.getHandshakeHeaders();
        String xff = headers.getFirst("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            return xff.split(",")[0].trim();
        }
        InetSocketAddress remoteAddress = session.getRemoteAddress();
        return remoteAddress != null ? remoteAddress.getAddress().getHostAddress() : "unknown";
    }

    private String getDeviceId(WebSocketSession session) {
        return getQueryParam(session, "deviceId") != null ? getQueryParam(session, "deviceId") : "unknown";
    }

    private String getQueryParam(WebSocketSession session, String name) {
        String query = session.getUri() != null ? session.getUri().getQuery() : null;
        if (query != null) {
            for (String param : query.split("&")) {
                String[] kv = param.split("=", 2);
                if (kv.length == 2 && name.equals(kv[0])) {
                    return kv[1];
                }
            }
        }
        return null;
    }

    private boolean validateWsToken(String token) {
        if (token == null || token.isEmpty()) return false;
        try {
            String json = AesUtil.decrypt(token, securityConfig.getAesKey());
            JsonNode node = mapper.readTree(json);

            String app = node.has("app") ? node.get("app").asText() : "";
            long ts = node.has("ts") ? node.get("ts").asLong() : 0;

            if (!securityConfig.getIdentityApp().equals(app)) return false;

            long now = System.currentTimeMillis() / 1000;
            return Math.abs(now - ts) <= securityConfig.getTokenMaxAgeSeconds();
        } catch (Exception e) {
            log.warn("[代理] WS token解析失败: {}", e.getMessage());
            return false;
        }
    }
}
