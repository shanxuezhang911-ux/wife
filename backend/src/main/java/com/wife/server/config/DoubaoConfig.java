package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "doubao")
public class DoubaoConfig {
    private String url;
    private String appId;
    private String accessToken;
    private String resourceId;
    private String appKey;
}
