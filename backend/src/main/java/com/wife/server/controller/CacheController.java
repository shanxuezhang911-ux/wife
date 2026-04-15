package com.wife.server.controller;

import com.wife.server.dto.ApiResponse;
import com.wife.server.dto.CacheRound;
import com.wife.server.service.AudioCacheService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cache")
public class CacheController {

    private static final Logger log = LoggerFactory.getLogger(CacheController.class);

    private final AudioCacheService audioCacheService;

    public CacheController(AudioCacheService audioCacheService) {
        this.audioCacheService = audioCacheService;
    }

    @PostMapping("/upload")
    @SuppressWarnings("unchecked")
    public ApiResponse<?> upload(@RequestBody Map<String, Object> body,
                                 @RequestHeader(value = "X-Device-Id", defaultValue = "unknown") String deviceId) {
        String sceneKey = (String) body.get("sceneKey");
        List<Map<String, String>> rawRounds = (List<Map<String, String>>) body.get("rounds");

        if (sceneKey == null || sceneKey.isBlank()) {
            return ApiResponse.error("sceneKey is required");
        }
        if (rawRounds == null || rawRounds.isEmpty()) {
            return ApiResponse.error("rounds is required");
        }

        List<CacheRound> rounds = rawRounds.stream()
                .map(r -> new CacheRound(r.get("text"), r.get("audioBase64")))
                .toList();

        log.info("[缓存] 收到上报 deviceId={}, sceneKey={}, 共{}轮",
                deviceId, sceneKey.substring(0, Math.min(30, sceneKey.length())), rounds.size());

        audioCacheService.saveCache(sceneKey, rounds, deviceId);
        return ApiResponse.ok("cached");
    }

    @GetMapping("/random")
    public ApiResponse<?> random(@RequestHeader(value = "X-Device-Id", defaultValue = "unknown") String deviceId) {
        Map<String, Object> cache = audioCacheService.getRandomCache(deviceId);
        if (cache == null) {
            return ApiResponse.error("no cache available");
        }
        return ApiResponse.ok(cache);
    }
}
