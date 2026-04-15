package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitConfig {
    private int ipMaxPerDay = 20;
    private int deviceMaxPerDay = 10;
}
