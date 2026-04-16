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
                try {
                    String decryptedBody = AesUtil.decrypt(encryptedBody.trim(), securityConfig.getAesKey());
                    wrappedRequest = new DecryptedBodyRequestWrapper(req, decryptedBody);
                } catch (Exception e) {
                    log.warn("[Security] body解密失败, uri={}", req.getRequestURI());
                    res.setStatus(403);
                    return;
                }
            }
        }

        // 3. 执行 controller，缓存响应
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

        private final byte[] body;

        public DecryptedBodyRequestWrapper(HttpServletRequest request, String decryptedBody) {
            super(request);
            this.body = decryptedBody.getBytes(StandardCharsets.UTF_8);
        }

        @Override
        public String getContentType() {
            return "application/json;charset=UTF-8";
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
