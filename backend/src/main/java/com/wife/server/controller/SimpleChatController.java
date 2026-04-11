package com.wife.server.controller;

import com.wife.server.service.GptStreamService;
import com.wife.server.service.TimeStateService;
import com.wife.server.util.SystemPromptBuilder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class SimpleChatController {

    private final GptStreamService gptStreamService;
    private final TimeStateService timeStateService;

    /**
     * POST /api/chat
     * 语音对话接口：接收用户文本，返回AI回复文本
     */
    @PostMapping("/chat")
    public Map<String, String> chat(@RequestBody Map<String, Object> body) {
        String userText = (String) body.getOrDefault("user_text", "");
        Integer timeHour = body.get("time_hour") != null
                ? Integer.parseInt(body.get("time_hour").toString())
                : null;

        log.info("chat请求, user_text={}, time_hour={}", userText, timeHour);

        String moodFragment = timeStateService.getMoodPromptFragment();
        String systemPrompt = SystemPromptBuilder.buildSystemPrompt(moodFragment);

        String aiText = gptStreamService.chatSync(systemPrompt, userText);
        return Map.of("ai_text", aiText);
    }
}
