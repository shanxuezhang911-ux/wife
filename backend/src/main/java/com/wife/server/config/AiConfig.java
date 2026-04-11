package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "ai")
public class AiConfig {

    private String provider;
    private Online online = new Online();

    @Data
    public static class Online {
        private String apiUrl;
        private String apiKey;
        private String model;
        private int timeout = 120000;
        private boolean stream = true;
    }
}
