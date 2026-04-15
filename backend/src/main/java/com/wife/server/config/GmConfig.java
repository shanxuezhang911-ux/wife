package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "gm")
public class GmConfig {
    private int port = 8092;
    private String token;
}
