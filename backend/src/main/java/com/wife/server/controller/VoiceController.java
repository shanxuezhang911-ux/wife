package com.wife.server.controller;

import com.wife.server.dto.ApiResponse;
import com.wife.server.dto.VoiceRequest;
import com.wife.server.service.VoiceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

/**
 * 语音API预留接口控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/voice")
@RequiredArgsConstructor
public class VoiceController {

    private final VoiceService voiceService;

    /**
     * ASR - 语音识别
     * 上传音频，返回识别文本
     */
    @PostMapping("/asr")
    public ApiResponse<Map<String, String>> recognizeSpeech(@RequestBody VoiceRequest request) {
        try {
            String text = voiceService.recognizeSpeech(request);
            return ApiResponse.ok(Map.of("text", text));
        } catch (UnsupportedOperationException e) {
            return ApiResponse.error(501, e.getMessage());
        } catch (Exception e) {
            log.error("ASR语音识别失败", e);
            return ApiResponse.error("语音识别失败: " + e.getMessage());
        }
    }

    /**
     * TTS - 流式语音合成
     * 输入文本，流式返回音频片段
     */
    @GetMapping(value = "/tts/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter synthesizeSpeech(@RequestParam String text, @RequestParam String sessionId) {
        try {
            return voiceService.synthesizeSpeechStream(text, sessionId);
        } catch (UnsupportedOperationException e) {
            SseEmitter emitter = new SseEmitter(5000L);
            try {
                emitter.send(SseEmitter.event().name("error").data("{\"error\":\"" + e.getMessage() + "\"}"));
                emitter.complete();
            } catch (Exception ignored) {}
            return emitter;
        }
    }

    /**
     * VAD - 人声检测打断
     * 上传音频片段，返回是否检测到人声及是否应该打断
     */
    @PostMapping("/vad/detect")
    public ApiResponse<Map<String, Object>> detectVoice(@RequestBody VoiceRequest request) {
        try {
            Map<String, Object> result = voiceService.detectVoiceActivity(request);
            return ApiResponse.ok(result);
        } catch (UnsupportedOperationException e) {
            return ApiResponse.error(501, e.getMessage());
        } catch (Exception e) {
            log.error("VAD检测失败", e);
            return ApiResponse.error("人声检测失败: " + e.getMessage());
        }
    }

    /**
     * 获取语音服务状态
     */
    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> getVoiceStatus() {
        return ApiResponse.ok(voiceService.getVoiceStatus());
    }
}
