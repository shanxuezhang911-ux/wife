package com.wife.server.controller;

import com.wife.server.config.SessionConfig;
import com.wife.server.dto.ApiResponse;
import com.wife.server.service.AudioCacheService;
import com.wife.server.service.OpeningService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/config")
public class ConfigController {

    private final SessionConfig sessionConfig;
    private final OpeningService openingService;
    private final AudioCacheService audioCacheService;

    public ConfigController(SessionConfig sessionConfig, OpeningService openingService, AudioCacheService audioCacheService) {
        this.sessionConfig = sessionConfig;
        this.openingService = openingService;
        this.audioCacheService = audioCacheService;
    }

    @GetMapping("/session")
    public ApiResponse<Map<String, Object>> getSessionConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("modelVersion", sessionConfig.getModelVersion());
        config.put("speaker", sessionConfig.getSpeaker());
        config.put("ttsSpeedRatio", sessionConfig.getTtsSpeedRatio());
        config.put("ttsPitchRatio", sessionConfig.getTtsPitchRatio());
        config.put("ttsVolumeRatio", sessionConfig.getTtsVolumeRatio());
        config.put("characterManifest", sessionConfig.getCharacterManifest());
        config.put("dialogTemperature", sessionConfig.getDialogTemperature());
        config.put("dialogTopP", sessionConfig.getDialogTopP());
        config.put("dialogMaxTokens", sessionConfig.getDialogMaxTokens());
        config.put("dialogFrequencyPenalty", sessionConfig.getDialogFrequencyPenalty());
        config.put("dialogPresencePenalty", sessionConfig.getDialogPresencePenalty());
        config.put("endSmoothWindowMs", sessionConfig.getEndSmoothWindowMs());
        config.put("timeoutMinutes", sessionConfig.getTimeoutMinutes());
        config.put("cacheMode", audioCacheService.isCacheMode());
        return ApiResponse.ok(config);
    }

    @GetMapping("/opening")
    public ApiResponse<String> getOpening() {
        return ApiResponse.ok(openingService.getRandomOpening());
    }

    @GetMapping("/silence")
    public ApiResponse<String> getSilence() {
        return ApiResponse.ok(openingService.getRandomSilence());
    }
}
