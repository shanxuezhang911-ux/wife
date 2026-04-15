package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "session")
public class SessionConfig {
    private String modelVersion;
    private String speaker;
    private double ttsSpeedRatio;
    private double ttsPitchRatio;
    private double ttsVolumeRatio;
    private String characterManifest;
    private double dialogTemperature;
    private double dialogTopP;
    private int dialogMaxTokens;
    private double dialogFrequencyPenalty;
    private double dialogPresencePenalty;
    private int endSmoothWindowMs;
    private int timeoutMinutes;
}
