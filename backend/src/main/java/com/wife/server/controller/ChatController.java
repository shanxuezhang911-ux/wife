package com.wife.server.controller;

import com.wife.server.dto.ApiResponse;
import com.wife.server.dto.ChatRequest;
import com.wife.server.service.ChatService;
import com.wife.server.service.OpeningLineService;
import com.wife.server.service.TimeStateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;
    private final OpeningLineService openingLineService;
    private final TimeStateService timeStateService;

    /**
     * 流式对话接口 - SSE推送
     * 前端通过EventSource连接，实时接收AI回复片段
     * 支持前端随时中断（关闭连接即可）
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamChat(@RequestBody ChatRequest request) {
        log.info("收到流式对话请求, sessionId={}", request.getSessionId());
        return chatService.streamChat(request);
    }

    /**
     * 获取攻击型开场台词
     * APP打开时自动调用，根据当前时间返回对应情绪的开场白
     */
    @GetMapping("/opening")
    public ApiResponse<Map<String, Object>> getOpening() {
        try {
            String line = openingLineService.getRandomOpeningLine();
            Map<String, String> stateInfo = timeStateService.getCurrentStateInfo();
            return ApiResponse.ok(Map.of(
                    "openingLine", line,
                    "moodState", stateInfo
            ));
        } catch (Exception e) {
            log.error("获取开场台词失败", e);
            return ApiResponse.error("获取开场台词失败: " + e.getMessage());
        }
    }

    /**
     * 获取当前情绪状态
     */
    @GetMapping("/mood")
    public ApiResponse<Map<String, String>> getMoodState() {
        return ApiResponse.ok(timeStateService.getCurrentStateInfo());
    }
}
