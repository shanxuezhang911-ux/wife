package com.wife.server.dto;

import lombok.Data;

import java.util.List;

@Data
public class ChatRequest {

    /**
     * 会话ID，用于关联上下文
     */
    private String sessionId;

    /**
     * 用户输入文本
     */
    private String message;

    /**
     * 历史消息（可选，前端传入）
     */
    private List<ChatMessage> history;

    @Data
    public static class ChatMessage {
        private String role;
        private String content;
    }
}
