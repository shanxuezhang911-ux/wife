package com.wife.server.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalTime;
import java.util.Map;

@Slf4j
@Service
public class TimeStateService {

    public enum MoodState {
        MORNING_GRUMPY("起床气模式", "刚醒，烦躁，不想说话，谁惹我我跟谁急"),
        NOON_COOKING("做饭抱怨模式", "做饭中，累得要死，你在哪？你从来不帮忙"),
        AFTERNOON_LAUNDRY("洗衣委屈模式", "洗衣服拖地，越干越委屈，你凭什么不动"),
        EVENING_EXHAUSTED("疲惫求哄模式", "累了一天，你不主动关心我就是不爱我"),
        NIGHT_BREAKDOWN("深夜崩溃模式", "失眠了，翻旧账，你以前说的话我都记得");

        private final String label;
        private final String description;

        MoodState(String label, String description) {
            this.label = label;
            this.description = description;
        }

        public String getLabel() { return label; }
        public String getDescription() { return description; }
    }

    /**
     * 根据当前系统时间返回对应的情绪状态
     */
    public MoodState getCurrentMoodState() {
        LocalTime now = LocalTime.now();
        int hour = now.getHour();

        MoodState state;
        if (hour >= 6 && hour < 10) {
            state = MoodState.MORNING_GRUMPY;
        } else if (hour >= 10 && hour < 14) {
            state = MoodState.NOON_COOKING;
        } else if (hour >= 14 && hour < 18) {
            state = MoodState.AFTERNOON_LAUNDRY;
        } else if (hour >= 18 && hour < 23) {
            state = MoodState.EVENING_EXHAUSTED;
        } else {
            state = MoodState.NIGHT_BREAKDOWN;
        }

        log.debug("当前时间: {}, 情绪状态: {}", now, state.getLabel());
        return state;
    }

    /**
     * 获取当前状态的Prompt注入片段
     */
    public String getMoodPromptFragment() {
        MoodState state = getCurrentMoodState();
        return String.format("""
                【当前时间状态：%s】
                现在的情绪核心：%s
                你必须完全沉浸在这个状态里，所有回复都要围绕当前状态的情绪来展开，不能跳出这个情绪框架。
                """, state.getLabel(), state.getDescription());
    }

    /**
     * 获取当前情绪状态详情（供前端查询）
     */
    public Map<String, String> getCurrentStateInfo() {
        MoodState state = getCurrentMoodState();
        return Map.of(
                "state", state.name(),
                "label", state.getLabel(),
                "description", state.getDescription(),
                "time", LocalTime.now().toString()
        );
    }
}
