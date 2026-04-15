package com.wife.server.config;

import com.wife.server.websocket.DoubaoProxyHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final DoubaoProxyHandler doubaoProxyHandler;

    public WebSocketConfig(DoubaoProxyHandler doubaoProxyHandler) {
        this.doubaoProxyHandler = doubaoProxyHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(doubaoProxyHandler, "/ws/doubao")
                .setAllowedOrigins("*");
    }
}
