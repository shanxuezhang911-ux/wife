package com.wife.server.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wife.server.config.CacheConfig;
import com.wife.server.dto.CacheRound;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.scheduling.annotation.Scheduled;

@Service
public class AudioCacheService {

    private static final Logger log = LoggerFactory.getLogger(AudioCacheService.class);
    private static final String CACHE_DIR = "data/audio-cache";
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CacheConfig cacheConfig;

    /** 内存索引：所有缓存文件名 */
    private final CopyOnWriteArrayList<String> cacheFiles = new CopyOnWriteArrayList<>();

    /** 设备每日已播放的缓存文件：deviceId → Set<fileName>，用于去重 */
    private final ConcurrentHashMap<String, Set<String>> devicePlayedToday = new ConcurrentHashMap<>();

    public AudioCacheService(CacheConfig cacheConfig) {
        this.cacheConfig = cacheConfig;
    }

    @PostConstruct
    public void init() {
        loadIndex();
    }

    public boolean isCacheMode() {
        return cacheConfig.isEnabled();
    }

    public void setCacheMode(boolean enabled) {
        cacheConfig.setEnabled(enabled);
        log.info("[缓存] 模式切换 enabled={}", enabled);
    }

    /**
     * 保存一次完整会话缓存
     */
    public void saveCache(String sceneKey, List<CacheRound> rounds, String deviceId) {
        try {
            File dir = new File(CACHE_DIR);
            dir.mkdirs();

            // 用 sceneKey 的 hashCode 做文件名，避免文件名过长
            String fileName = "scene_" + Math.abs(sceneKey.hashCode()) + "_" + System.currentTimeMillis() + ".json";
            File file = new File(dir, fileName);

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("sceneKey", sceneKey);
            data.put("deviceId", deviceId);
            data.put("createdAt", LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            data.put("roundCount", rounds.size());
            data.put("rounds", rounds);

            objectMapper.writerWithDefaultPrettyPrinter().writeValue(file, data);
            cacheFiles.add(fileName);

            long totalBytes = rounds.stream().mapToLong(r -> r.getAudioBase64() != null ? r.getAudioBase64().length() : 0).sum();
            log.info("[缓存] 写入 sceneKey={}, 共{}轮, 大小{}KB, deviceId={}, file={}",
                    sceneKey.substring(0, Math.min(30, sceneKey.length())),
                    rounds.size(), totalBytes / 1024, deviceId, fileName);
        } catch (IOException e) {
            log.error("[缓存] 写入失败", e);
        }
    }

    /**
     * 根据缓存数量计算命中概率
     */
    private int getCacheHitPercent() {
        int count = cacheFiles.size();
        if (count >= 2000) return 95;
        if (count >= 1000) return 80;
        if (count >= 500) return 40;
        if (count >= 300) return 30;
        if (count >= 100) return 20;
        return 0; // 不足100不走缓存
    }

    /**
     * 尝试获取缓存（含概率判断 + 设备去重）
     * @param deviceId 设备ID，用于同天去重
     * @return 缓存数据，null 表示未命中（走实时模式）
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getRandomCache(String deviceId) {
        int total = cacheFiles.size();
        int hitPercent = getCacheHitPercent();

        // 缓存不足，不走缓存
        if (hitPercent == 0) {
            log.info("[缓存] 未命中, 原因=缓存不足({}个<100), deviceId={}", total, deviceId);
            return null;
        }

        // 概率判断
        int roll = ThreadLocalRandom.current().nextInt(100);
        if (roll >= hitPercent) {
            log.info("[缓存] 未命中, 原因=概率未中(roll={}>={}%), 缓存总数={}, deviceId={}", roll, hitPercent, total, deviceId);
            return null;
        }

        // 获取该设备今天已播放的集合
        Set<String> played = devicePlayedToday.computeIfAbsent(deviceId, k -> ConcurrentHashMap.newKeySet());

        // 找出未播放过的缓存
        List<String> candidates = new ArrayList<>();
        for (String f : cacheFiles) {
            if (!played.contains(f)) candidates.add(f);
        }

        if (candidates.isEmpty()) {
            log.info("[缓存] 未命中, 原因=今日已全部播放(已播{}个), deviceId={}", played.size(), deviceId);
            return null;
        }

        // 随机选一个
        String fileName = candidates.get(ThreadLocalRandom.current().nextInt(candidates.size()));
        File file = new File(CACHE_DIR, fileName);
        if (!file.exists()) {
            cacheFiles.remove(fileName);
            log.warn("[缓存] 文件不存在, 已移除索引: {}", fileName);
            return null;
        }

        try {
            Map<String, Object> data = objectMapper.readValue(file, new TypeReference<Map<String, Object>>() {});
            String sceneKey = (String) data.getOrDefault("sceneKey", "unknown");
            int roundCount = data.get("rounds") instanceof List ? ((List<?>) data.get("rounds")).size() : 0;

            // 记录已播放
            played.add(fileName);

            log.info("[缓存] 命中! sceneKey={}, 共{}轮, file={}, 概率={}%, roll={}, 缓存总数={}, 设备今日已播={}, deviceId={}",
                    sceneKey.substring(0, Math.min(30, sceneKey.length())), roundCount, fileName,
                    hitPercent, roll, total, played.size(), deviceId);
            return data;
        } catch (IOException e) {
            log.error("[缓存] 读取失败: {}", fileName, e);
            return null;
        }
    }

    /**
     * 每日零点清除设备播放记录
     */
    @Scheduled(cron = "0 0 0 * * *")
    public void resetDailyPlayed() {
        int deviceCount = devicePlayedToday.size();
        devicePlayedToday.clear();
        log.info("[缓存] 每日重置设备播放记录, 清除{}个设备记录", deviceCount);
    }

    public int getCacheCount() {
        return cacheFiles.size();
    }

    public List<Map<String, String>> listCacheKeys() {
        List<Map<String, String>> result = new ArrayList<>();
        for (String fileName : cacheFiles) {
            File file = new File(CACHE_DIR, fileName);
            if (!file.exists()) continue;
            try {
                Map<String, Object> data = objectMapper.readValue(file, new TypeReference<Map<String, Object>>() {});
                Map<String, String> info = new LinkedHashMap<>();
                info.put("file", fileName);
                info.put("sceneKey", String.valueOf(data.getOrDefault("sceneKey", "")));
                info.put("createdAt", String.valueOf(data.getOrDefault("createdAt", "")));
                info.put("roundCount", String.valueOf(data.getOrDefault("roundCount", 0)));
                result.add(info);
            } catch (IOException e) {
                // skip
            }
        }
        return result;
    }

    public boolean deleteCache(String fileName) {
        File file = new File(CACHE_DIR, fileName);
        if (file.exists() && file.delete()) {
            cacheFiles.remove(fileName);
            log.info("[缓存] 删除 file={}", fileName);
            return true;
        }
        return false;
    }

    private void loadIndex() {
        File dir = new File(CACHE_DIR);
        if (!dir.exists()) {
            log.info("[缓存] 启动加载 {}, 目录不存在, 跳过", CACHE_DIR);
            return;
        }
        File[] files = dir.listFiles((d, name) -> name.endsWith(".json"));
        if (files == null || files.length == 0) {
            log.info("[缓存] 启动加载 {}, 共0个缓存文件", CACHE_DIR);
            return;
        }
        for (File f : files) {
            cacheFiles.add(f.getName());
        }
        log.info("[缓存] 启动加载 {}, 共{}个缓存文件", CACHE_DIR, cacheFiles.size());
    }
}
