package com.wife.server.config;

import org.apache.catalina.connector.Connector;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.DispatcherServlet;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * GM 管理接口独立端口
 * 主服务 :8091（前端API + WebSocket）
 * GM服务 :8092（管理接口）
 *
 * 通过 Tomcat 额外 Connector 监听 8092 端口，
 * 通过 Filter 限制 /gm/** 只能从 8092 端口访问。
 */
@Configuration
public class GmServerConfig {

    private final GmConfig gmConfig;

    public GmServerConfig(GmConfig gmConfig) {
        this.gmConfig = gmConfig;
    }

    @Bean
    public TomcatServletWebServerFactory tomcatServletWebServerFactory() {
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory();
        // 添加 GM 端口作为额外 Connector
        Connector connector = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
        connector.setPort(gmConfig.getPort());
        factory.addAdditionalTomcatConnectors(connector);
        return factory;
    }

    @Bean
    public FilterRegistrationBean<GmPortFilter> gmPortFilter() {
        FilterRegistrationBean<GmPortFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new GmPortFilter(gmConfig.getPort()));
        registration.addUrlPatterns("/gm/*");
        registration.setOrder(1);
        return registration;
    }

    /**
     * 限制 /gm/** 只能通过 GM 端口访问
     */
    static class GmPortFilter implements Filter {
        private final int gmPort;

        GmPortFilter(int gmPort) {
            this.gmPort = gmPort;
        }

        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            if (request.getLocalPort() != gmPort) {
                HttpServletResponse httpResp = (HttpServletResponse) response;
                httpResp.setStatus(404);
                httpResp.getWriter().write("Not Found");
                return;
            }
            chain.doFilter(request, response);
        }
    }
}
