package com.wife.server.controller;

import com.wife.server.config.GmConfig;
import com.wife.server.dto.ApiResponse;
import com.wife.server.dto.Sponsor;
import com.wife.server.service.AudioCacheService;
import com.wife.server.service.RateLimitService;
import com.wife.server.service.SponsorService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/gm")
public class GmController {

    private final GmConfig gmConfig;
    private final RateLimitService rateLimitService;
    private final SponsorService sponsorService;
    private final AudioCacheService audioCacheService;

    public GmController(GmConfig gmConfig, RateLimitService rateLimitService,
                        SponsorService sponsorService, AudioCacheService audioCacheService) {
        this.gmConfig = gmConfig;
        this.rateLimitService = rateLimitService;
        this.sponsorService = sponsorService;
        this.audioCacheService = audioCacheService;
    }

    // ==================== 鉴权 ====================

    private boolean checkToken(HttpServletRequest request) {
        String token = request.getHeader("X-GM-Token");
        return gmConfig.getToken() != null && gmConfig.getToken().equals(token);
    }

    // ==================== 赞助名单 ====================

    @GetMapping("/sponsors")
    public ApiResponse<?> getSponsors(HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        return ApiResponse.ok(sponsorService.getSponsors());
    }

    @PostMapping("/sponsors/add")
    public ApiResponse<?> addSponsor(@RequestBody Sponsor sponsor, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        if (sponsor.getName() == null || sponsor.getName().isBlank()) return ApiResponse.error("name is required");
        Sponsor added = sponsorService.addSponsor(sponsor);
        return ApiResponse.ok(added);
    }

    @PutMapping("/sponsors/{id}")
    public ApiResponse<?> updateSponsor(@PathVariable String id, @RequestBody Sponsor sponsor, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        Sponsor updated = sponsorService.updateSponsor(id, sponsor);
        return updated != null ? ApiResponse.ok(updated) : ApiResponse.error("not found");
    }

    @DeleteMapping("/sponsors/{id}")
    public ApiResponse<?> removeSponsor(@PathVariable String id, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        boolean removed = sponsorService.removeSponsor(id);
        return removed ? ApiResponse.ok("deleted") : ApiResponse.error("not found");
    }

    // ==================== 设备限流覆盖 ====================

    @GetMapping("/device-limits")
    public ApiResponse<?> getDeviceLimits(HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        return ApiResponse.ok(rateLimitService.getDeviceOverrides());
    }

    @PostMapping("/device-limits")
    public ApiResponse<?> setDeviceLimit(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        String deviceId = (String) body.get("deviceId");
        Object maxObj = body.get("maxPerDay");
        if (deviceId == null || deviceId.isBlank()) return ApiResponse.error("deviceId is required");
        if (maxObj == null) return ApiResponse.error("maxPerDay is required");
        int maxPerDay = maxObj instanceof Number ? ((Number) maxObj).intValue() : Integer.parseInt(maxObj.toString());
        rateLimitService.setDeviceLimit(deviceId.trim(), maxPerDay);
        return ApiResponse.ok(rateLimitService.getDeviceOverrides());
    }

    @DeleteMapping("/device-limits/{deviceId}")
    public ApiResponse<?> removeDeviceLimit(@PathVariable String deviceId, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        boolean removed = rateLimitService.removeDeviceLimit(deviceId);
        return removed ? ApiResponse.ok("deleted") : ApiResponse.error("not found");
    }

    // ==================== 全局限流管理 ====================

    @GetMapping("/rate-limit")
    public ApiResponse<?> getRateLimit(HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        return ApiResponse.ok(rateLimitService.getStats());
    }

    @PostMapping("/rate-limit")
    public ApiResponse<?> updateRateLimit(@RequestBody Map<String, Integer> body, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        rateLimitService.updateLimits(body.get("ipMaxPerDay"), body.get("deviceMaxPerDay"));
        return ApiResponse.ok(rateLimitService.getStats());
    }

    // ==================== 统计 ====================

    @GetMapping("/stats")
    public ApiResponse<?> getStats(HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        return ApiResponse.ok(rateLimitService.getStats());
    }

    // ==================== 缓存管理 ====================

    @GetMapping("/cache-stats")
    public ApiResponse<?> getCacheStats(HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        Map<String, Object> stats = new HashMap<>();
        stats.put("enabled", audioCacheService.isCacheMode());
        stats.put("count", audioCacheService.getCacheCount());
        stats.put("caches", audioCacheService.listCacheKeys());
        return ApiResponse.ok(stats);
    }

    @PostMapping("/cache-mode")
    public ApiResponse<?> setCacheMode(@RequestBody Map<String, Boolean> body, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        Boolean enabled = body.get("enabled");
        if (enabled == null) return ApiResponse.error("enabled is required");
        audioCacheService.setCacheMode(enabled);
        return ApiResponse.ok("cache mode: " + enabled);
    }

    @DeleteMapping("/cache/{fileName}")
    public ApiResponse<?> deleteCache(@PathVariable String fileName, HttpServletRequest request) {
        if (!checkToken(request)) return ApiResponse.error(403, "Forbidden");
        boolean deleted = audioCacheService.deleteCache(fileName);
        return deleted ? ApiResponse.ok("deleted") : ApiResponse.error("not found");
    }
}
