package com.wife.server.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wife.server.config.RateLimitConfig;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class RateLimitService {

    private static final Logger log = LoggerFactory.getLogger(RateLimitService.class);
    private static final String DEVICE_LIMITS_FILE = "data/device-limits.json";

    private final RateLimitConfig config;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final ConcurrentHashMap<String, AtomicInteger> ipCounts = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicInteger> deviceCounts = new ConcurrentHashMap<>();

    /** 设备级限流覆盖：deviceId → maxPerDay */
    private final ConcurrentHashMap<String, Integer> deviceOverrides = new ConcurrentHashMap<>();

    private final AtomicInteger totalToday = new AtomicInteger(0);
    private final AtomicInteger blockedToday = new AtomicInteger(0);

    public RateLimitService(RateLimitConfig config) {
        this.config = config;
    }

    @PostConstruct
    public void init() {
        loadDeviceOverrides();
    }

    /**
     * 检查并记录访问，返回是否放行
     */
    public boolean checkAndIncrement(String ip, String deviceId) {
        totalToday.incrementAndGet();

        // 设备级 -1 表示不限流（同时跳过IP检查）
        if (deviceId != null && !"unknown".equals(deviceId)) {
            Integer override = deviceOverrides.get(deviceId);
            if (override != null && override == -1) {
                deviceCounts.computeIfAbsent(deviceId, k -> new AtomicInteger(0)).incrementAndGet();
                ipCounts.computeIfAbsent(ip != null ? ip : "unknown", k -> new AtomicInteger(0)).incrementAndGet();
                return true;
            }
        }

        // IP 检查
        if (ip != null && !"unknown".equals(ip)) {
            int ipCount = ipCounts.computeIfAbsent(ip, k -> new AtomicInteger(0)).incrementAndGet();
            if (ipCount > config.getIpMaxPerDay()) {
                blockedToday.incrementAndGet();
                log.warn("[限流] IP {} 超限 {}/{}", ip, ipCount, config.getIpMaxPerDay());
                return false;
            }
        }

        // 设备 ID 检查（优先使用设备级覆盖）
        if (deviceId != null && !"unknown".equals(deviceId)) {
            int devCount = deviceCounts.computeIfAbsent(deviceId, k -> new AtomicInteger(0)).incrementAndGet();
            int maxPerDay = deviceOverrides.getOrDefault(deviceId, config.getDeviceMaxPerDay());
            if (devCount > maxPerDay) {
                blockedToday.incrementAndGet();
                log.warn("[限流] Device {} 超限 {}/{}", deviceId, devCount, maxPerDay);
                return false;
            }
        }

        return true;
    }

    /**
     * 每天零点清零
     */
    @Scheduled(cron = "0 0 0 * * *")
    public void resetDaily() {
        log.info("[限流] 每日重置 - 昨日总访问:{} 拦截:{}", totalToday.get(), blockedToday.get());
        ipCounts.clear();
        deviceCounts.clear();
        totalToday.set(0);
        blockedToday.set(0);
    }

    /**
     * GM 动态修改全局限流参数
     */
    public void updateLimits(Integer ipMax, Integer deviceMax) {
        if (ipMax != null) config.setIpMaxPerDay(ipMax);
        if (deviceMax != null) config.setDeviceMaxPerDay(deviceMax);
        log.info("[限流] 参数已更新 ipMax={} deviceMax={}", config.getIpMaxPerDay(), config.getDeviceMaxPerDay());
    }

    /**
     * 设置设备级限流覆盖
     */
    public void setDeviceLimit(String deviceId, int maxPerDay) {
        deviceOverrides.put(deviceId, maxPerDay);
        saveDeviceOverrides();
        log.info("[限流] 设备 {} 限流设为 {}/天", deviceId, maxPerDay);
    }

    /**
     * 删除设备级限流覆盖（恢复全局默认）
     */
    public boolean removeDeviceLimit(String deviceId) {
        boolean removed = deviceOverrides.remove(deviceId) != null;
        if (removed) {
            saveDeviceOverrides();
            log.info("[限流] 设备 {} 恢复全局限流", deviceId);
        }
        return removed;
    }

    /**
     * 获取所有设备级限流覆盖
     */
    public Map<String, Integer> getDeviceOverrides() {
        return new HashMap<>(deviceOverrides);
    }

    /**
     * 获取当前统计
     */
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("ipMaxPerDay", config.getIpMaxPerDay());
        stats.put("deviceMaxPerDay", config.getDeviceMaxPerDay());
        stats.put("totalToday", totalToday.get());
        stats.put("blockedToday", blockedToday.get());
        stats.put("uniqueIps", ipCounts.size());
        stats.put("uniqueDevices", deviceCounts.size());
        stats.put("deviceOverrides", new HashMap<>(deviceOverrides));
        return stats;
    }

    private void loadDeviceOverrides() {
        File file = new File(DEVICE_LIMITS_FILE);
        if (file.exists()) {
            try {
                Map<String, Integer> loaded = objectMapper.readValue(file, new TypeReference<Map<String, Integer>>() {});
                deviceOverrides.putAll(loaded);
                log.info("[限流] 加载 {} 条设备级限流覆盖", deviceOverrides.size());
            } catch (IOException e) {
                log.error("[限流] 加载设备限流失败", e);
            }
        }
    }

    private void saveDeviceOverrides() {
        try {
            File file = new File(DEVICE_LIMITS_FILE);
            file.getParentFile().mkdirs();
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(file, deviceOverrides);
        } catch (IOException e) {
            log.error("[限流] 保存设备限流失败", e);
        }
    }
}
