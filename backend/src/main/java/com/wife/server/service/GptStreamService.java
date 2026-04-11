package com.wife.server.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wife.server.config.AiConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class GptStreamService {

    private final AiConfig aiConfig;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 流式调用GPT接口，将结果推送到SseEmitter
     *
     * @param systemPrompt 系统提示词
     * @param messages     对话历史
     * @param emitter      SSE发射器
     */
    public void streamChat(String systemPrompt, List<Map<String, String>> messages, SseEmitter emitter) {
        HttpURLConnection connection = null;
        try {
            AiConfig.Online config = aiConfig.getOnline();

            // 构建请求体
            Map<String, Object> requestBody = buildRequestBody(systemPrompt, messages, config);
            String jsonBody = objectMapper.writeValueAsString(requestBody);

            log.debug("GPT请求URL: {}", config.getApiUrl());
            log.debug("GPT请求体: {}", jsonBody);

            // 建立连接
            connection = (HttpURLConnection) URI.create(config.getApiUrl()).toURL().openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + config.getApiKey());
            connection.setConnectTimeout(config.getTimeout());
            connection.setReadTimeout(config.getTimeout());
            connection.setDoOutput(true);

            // 发送请求
            try (var os = connection.getOutputStream()) {
                os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                os.flush();
            }

            int responseCode = connection.getResponseCode();
            if (responseCode != 200) {
                String errorBody = readErrorStream(connection);
                log.error("GPT API返回错误: code={}, body={}", responseCode, errorBody);
                emitter.send(SseEmitter.event().name("error").data("{\"error\":\"GPT API错误: " + responseCode + "\"}"));
                emitter.complete();
                return;
            }

            // 流式读取响应
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    if (!line.startsWith("data: ")) continue;

                    String data = line.substring(6).trim();
                    if ("[DONE]".equals(data)) {
                        emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                        break;
                    }

                    try {
                        String content = extractContent(data);
                        if (content != null && !content.isEmpty()) {
                            emitter.send(SseEmitter.event().name("message").data(content));
                        }
                    } catch (Exception e) {
                        log.warn("解析流式数据失败: {}", data, e);
                    }
                }
            }

            emitter.complete();
            log.debug("GPT流式响应完成");

        } catch (Exception e) {
            log.error("GPT流式请求失败", e);
            try {
                emitter.send(SseEmitter.event().name("error").data("{\"error\":\"" + e.getMessage() + "\"}"));
                emitter.complete();
            } catch (Exception ignored) {}
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /**
     * 非流式调用（用于开场白生成等场景）
     */
    public String chatSync(String systemPrompt, String userMessage) {
        try {
            AiConfig.Online config = aiConfig.getOnline();

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "user", "content", userMessage));

            Map<String, Object> requestBody = buildRequestBody(systemPrompt, messages, config);
            requestBody.put("stream", false);

            String jsonBody = objectMapper.writeValueAsString(requestBody);

            HttpURLConnection connection = (HttpURLConnection) URI.create(config.getApiUrl()).toURL().openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + config.getApiKey());
            connection.setConnectTimeout(config.getTimeout());
            connection.setReadTimeout(config.getTimeout());
            connection.setDoOutput(true);

            try (var os = connection.getOutputStream()) {
                os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
                os.flush();
            }

            int responseCode = connection.getResponseCode();
            if (responseCode != 200) {
                String errorBody = readErrorStream(connection);
                throw new RuntimeException("GPT API错误: " + responseCode + " - " + errorBody);
            }

            String responseBody;
            try (var is = connection.getInputStream()) {
                responseBody = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }

            JsonNode root = objectMapper.readTree(responseBody);
            JsonNode choices = root.path("choices");
            if (choices.isArray() && !choices.isEmpty()) {
                return choices.get(0).path("message").path("content").asText("");
            }

            // 兼容 responses API 格式
            JsonNode output = root.path("output");
            if (output.isArray()) {
                for (JsonNode item : output) {
                    if ("message".equals(item.path("type").asText())) {
                        JsonNode contentArr = item.path("content");
                        if (contentArr.isArray() && !contentArr.isEmpty()) {
                            return contentArr.get(0).path("text").asText("");
                        }
                    }
                }
            }

            return responseBody;

        } catch (Exception e) {
            log.error("GPT同步请求失败", e);
            throw new RuntimeException("AI请求失败: " + e.getMessage());
        }
    }

    private Map<String, Object> buildRequestBody(String systemPrompt, List<Map<String, String>> messages, AiConfig.Online config) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", config.getModel());
        body.put("stream", config.isStream());

        List<Map<String, String>> fullMessages = new ArrayList<>();
        fullMessages.add(Map.of("role", "system", "content", systemPrompt));
        fullMessages.addAll(messages);

        body.put("messages", fullMessages);
        body.put("temperature", 0.95);
        body.put("max_tokens", 2048);
        return body;
    }

    /**
     * 从流式数据中提取文本内容，兼容多种格式
     */
    private String extractContent(String jsonData) throws Exception {
        JsonNode root = objectMapper.readTree(jsonData);

        // 标准 OpenAI chat completions 格式
        JsonNode choices = root.path("choices");
        if (choices.isArray() && !choices.isEmpty()) {
            JsonNode delta = choices.get(0).path("delta");
            String content = delta.path("content").asText(null);
            if (content != null) return content;
        }

        // responses API 格式
        String type = root.path("type").asText("");
        if ("response.output_text.delta".equals(type)) {
            return root.path("delta").asText(null);
        }
        if ("response.content_part.delta".equals(type)) {
            return root.path("delta").path("text").asText(null);
        }

        return null;
    }

    private String readErrorStream(HttpURLConnection connection) {
        try {
            if (connection.getErrorStream() != null) {
                return new String(connection.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {}
        return "unknown error";
    }
}
