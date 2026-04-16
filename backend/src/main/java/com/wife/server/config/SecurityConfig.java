package com.wife.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "security")
public class SecurityConfig {

    private String aesKey = "w1f3S3rv3r@2026!";
    private String identityApp = "wife";
    private int tokenMaxAgeSeconds = 300;

    public String getAesKey() { return aesKey; }
    public void setAesKey(String aesKey) { this.aesKey = aesKey; }

    public String getIdentityApp() { return identityApp; }
    public void setIdentityApp(String identityApp) { this.identityApp = identityApp; }

    public int getTokenMaxAgeSeconds() { return tokenMaxAgeSeconds; }
    public void setTokenMaxAgeSeconds(int tokenMaxAgeSeconds) { this.tokenMaxAgeSeconds = tokenMaxAgeSeconds; }
}
