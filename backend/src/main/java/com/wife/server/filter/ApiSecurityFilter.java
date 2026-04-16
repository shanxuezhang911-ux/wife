package com.wife.server.filter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wife.server.config.SecurityConfig;
import com.wife.server.util.AesUtil;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.*;
import java.nio.charset.StandardCharsets;

public class ApiSecurityFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(ApiSecurityFilter.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final SecurityConfig securityConfig;

    public ApiSecurityFilter(SecurityConfig securityConfig) {
        this.securityConfig = securityConfig;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        // 请求日志：IP来源 + 方法 + URL
        String clientIp = getClientIp(req);
        log.info("[Security] {} {} {} ip={}", req.getMethod(), req.getRequestURI(),
                req.getQueryString() != null ? "?" + req.getQueryString() : "", clientIp);

        // 1. 验证身份 token
        String token = req.getHeader("X-Auth-Token");
        if (token == null || token.isEmpty()) {
            log.warn("[Security] 缺少X-Auth-Token, uri={}", req.getRequestURI());
            res.setStatus(403);
            return;
        }

        if (!validateToken(token)) {
            log.warn("[Security] token校验失败, uri={}", req.getRequestURI());
            res.setStatus(403);
            return;
        }

        // 2. 解密 POST/PUT body
        HttpServletRequest wrappedRequest = req;
        if (hasBody(req)) {
            String encryptedBody = readBody(req);
            if (encryptedBody != null && !encryptedBody.isEmpty()) {
                log.debug("[Security] body长度: {}字节, uri={}", encryptedBody.length(), req.getRequestURI());
                try {
                    String decryptedBody = AesUtil.decrypt(encryptedBody.trim(), securityConfig.getAesKey());
                    log.debug("[Security] 解密后body长度: {}字节", decryptedBody.length());
                    wrappedRequest = new DecryptedBodyRequestWrapper(req, decryptedBody);
                } catch (Exception e) {
                    log.warn("[Security] body解密失败, uri={}, bodyLen={}, error={}",
                            req.getRequestURI(), encryptedBody.length(), e.getMessage());
                    res.setStatus(403);
                    return;
                }
            }
        }

        // 3. 判断是否为流式接口（SSE），流式接口不能缓冲响应
        boolean isStreaming = req.getRequestURI().contains("/stream");

        if (isStreaming) {
            // SSE/流式接口：只验token+解密body，不加密响应（避免缓冲破坏流式推送）
            chain.doFilter(wrappedRequest, res);
        } else {
            // 普通接口：缓存响应后加密
            ContentCachingResponseWrapper wrappedResponse = new ContentCachingResponseWrapper(res);
            chain.doFilter(wrappedRequest, wrappedResponse);

            // 4. 加密响应 body
            byte[] responseBody = wrappedResponse.getContentAsByteArray();
            if (responseBody.length > 0 && isJsonResponse(wrappedResponse)) {
                String plainResponse = new String(responseBody, StandardCharsets.UTF_8);
                String encryptedResponse = AesUtil.encrypt(plainResponse, securityConfig.getAesKey());

                wrappedResponse.resetBuffer();
                res.setContentType("text/plain;charset=UTF-8");
                res.setContentLength(encryptedResponse.getBytes(StandardCharsets.UTF_8).length);
                res.getOutputStream().write(encryptedResponse.getBytes(StandardCharsets.UTF_8));
                res.getOutputStream().flush();
            } else {
                wrappedResponse.copyBodyToResponse();
            }
        }
    }

    private boolean validateToken(String token) {
        try {
            String json = AesUtil.decrypt(token, securityConfig.getAesKey());
            JsonNode node = mapper.readTree(json);

            String app = node.has("app") ? node.get("app").asText() : "";
            long ts = node.has("ts") ? node.get("ts").asLong() : 0;

            if (!securityConfig.getIdentityApp().equals(app)) {
                log.warn("[Security] app不匹配: {}", app);
                return false;
            }

            long now = System.currentTimeMillis() / 1000;
            if (Math.abs(now - ts) > securityConfig.getTokenMaxAgeSeconds()) {
                log.warn("[Security] token过期, ts={}, now={}, diff={}s", ts, now, Math.abs(now - ts));
                return false;
            }

            return true;
        } catch (Exception e) {
            log.warn("[Security] token解析异常: {}", e.getMessage());
            return false;
        }
    }

    private boolean hasBody(HttpServletRequest req) {
        String method = req.getMethod().toUpperCase();
        return "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
    }

    private boolean isJsonResponse(ContentCachingResponseWrapper response) {
        String contentType = response.getContentType();
        return contentType != null && contentType.contains("application/json");
    }

    private String getClientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            return xff.split(",")[0].trim();
        }
        String realIp = req.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isEmpty()) {
            return realIp;
        }
        return req.getRemoteAddr();
    }

    private String readBody(HttpServletRequest req) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = req.getReader()) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    /**
     * 替换 request body 的 wrapper
     */
    private static class DecryptedBodyRequestWrapper extends HttpServletRequestWrapper {

        private static final String JSON_CONTENT_TYPE = "application/json;charset=UTF-8";
        private final byte[] body;

        public DecryptedBodyRequestWrapper(HttpServletRequest request, String decryptedBody) {
            super(request);
            this.body = decryptedBody.getBytes(StandardCharsets.UTF_8);
        }

        @Override
        public String getContentType() {
            return JSON_CONTENT_TYPE;
        }

        @Override
        public String getHeader(String name) {
            if ("Content-Type".equalsIgnoreCase(name)) {
                return JSON_CONTENT_TYPE;
            }
            return super.getHeader(name);
        }

        @Override
        public java.util.Enumeration<String> getHeaders(String name) {
            if ("Content-Type".equalsIgnoreCase(name)) {
                return java.util.Collections.enumeration(java.util.Collections.singletonList(JSON_CONTENT_TYPE));
            }
            return super.getHeaders(name);
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream bais = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public boolean isFinished() { return bais.available() == 0; }
                @Override
                public boolean isReady() { return true; }
                @Override
                public void setReadListener(ReadListener listener) {}
                @Override
                public int read() { return bais.read(); }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(new ByteArrayInputStream(body), StandardCharsets.UTF_8));
        }
    }
}
