package com.wife.server.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "voice")
public class VoiceConfig {

    private Asr asr = new Asr();
    private Tts tts = new Tts();
    private Vad vad = new Vad();

    @Data
    public static class Asr {
        private boolean enabled;
        private String apiUrl;
        private String apiKey;
    }

    @Data
    public static class Tts {
        private boolean enabled;
        private String apiUrl;
        private String apiKey;
        private String voiceId;
        private double speed = 1.0;
    }

    @Data
    public static class Vad {
        private boolean enabled;
        private int silenceThresholdMs = 800;
        private boolean interruptEnabled = true;
    }
}
