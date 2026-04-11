package com.wife.server.dto;

import lombok.Data;

@Data
public class VoiceRequest {

    /**
     * 会话ID
     */
    private String sessionId;

    /**
     * Base64编码的音频数据
     */
    private String audioData;

    /**
     * 音频格式：wav, pcm, mp3
     */
    private String format;

    /**
     * 采样率
     */
    private int sampleRate;
}
