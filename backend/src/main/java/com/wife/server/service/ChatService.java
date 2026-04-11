package com.wife.server.service;

import com.wife.server.dto.ChatRequest;
import com.wife.server.util.SystemPromptBuilder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class ChatService {

    private final GptStreamService gptStreamService;
    private final TimeStateService timeStateService;

    /**
     * 流式对话 - 核心入口
     */
    public SseEmitter streamChat(ChatRequest request) {
        // 超时时间 3 分钟
        SseEmitter emitter = new SseEmitter(180000L);

        // 构建系统Prompt（基础人设 + 时间状态）
        String moodFragment = timeStateService.getMoodPromptFragment();
        String systemPrompt = SystemPromptBuilder.buildSystemPrompt(moodFragment);

        // 构建消息列表
        List<Map<String, String>> messages = buildMessages(request);

        log.info("开始流式对话, sessionId={}, 消息数={}, 当前状态={}",
                request.getSessionId(), messages.size(),
                timeStateService.getCurrentMoodState().getLabel());

        // 异步执行流式请求
        new Thread(() -> {
            try {
                gptStreamService.streamChat(systemPrompt, messages, emitter);
            } catch (Exception e) {
                log.error("流式对话异常", e);
                try {
                    emitter.send(SseEmitter.event().name("error")
                            .data("{\"error\":\"对话异常: " + e.getMessage() + "\"}"));
                    emitter.complete();
                } catch (Exception ignored) {}
            }
        }).start();

        emitter.onTimeout(() -> {
            log.warn("SSE连接超时, sessionId={}", request.getSessionId());
            emitter.complete();
        });

        emitter.onError(e -> {
            log.warn("SSE连接错误, sessionId={}", request.getSessionId(), e);
        });

        return emitter;
    }

    private List<Map<String, String>> buildMessages(ChatRequest request) {
        List<Map<String, String>> messages = new ArrayList<>();

        // 加入历史消息
        if (request.getHistory() != null) {
            for (ChatRequest.ChatMessage msg : request.getHistory()) {
                Map<String, String> m = new HashMap<>();
                m.put("role", msg.getRole());
                m.put("content", msg.getContent());
                messages.add(m);
            }
        }

        // 加入当前用户消息
        if (request.getMessage() != null && !request.getMessage().isBlank()) {
            Map<String, String> userMsg = new HashMap<>();
            userMsg.put("role", "user");
            userMsg.put("content", request.getMessage());
            messages.add(userMsg);
        }

        return messages;
    }
}
