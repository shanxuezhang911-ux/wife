package com.wife.server.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Random;

@Slf4j
@Service
@RequiredArgsConstructor
public class OpeningLineService {

    private final TimeStateService timeStateService;
    private final Random random = new Random();
    private Map<String, List<String>> openingLines;

    @PostConstruct
    public void init() {
        try {
            ClassPathResource resource = new ClassPathResource("opening-lines.json");
            try (InputStream is = resource.getInputStream()) {
                ObjectMapper mapper = new ObjectMapper();
                openingLines = mapper.readValue(is, new TypeReference<>() {});
            }
            log.info("开场台词库加载成功，共{}个状态", openingLines.size());
        } catch (Exception e) {
            log.error("开场台词库加载失败", e);
            throw new RuntimeException("开场台词库加载失败", e);
        }
    }

    /**
     * 根据当前时间状态随机获取一条攻击型开场台词
     */
    public String getRandomOpeningLine() {
        TimeStateService.MoodState state = timeStateService.getCurrentMoodState();
        List<String> lines = openingLines.get(state.name());
        if (lines == null || lines.isEmpty()) {
            return "你来了？你来干嘛？良心发现了？";
        }
        String line = lines.get(random.nextInt(lines.size()));
        log.debug("开场台词[{}]: {}", state.getLabel(), line);
        return line;
    }
}
