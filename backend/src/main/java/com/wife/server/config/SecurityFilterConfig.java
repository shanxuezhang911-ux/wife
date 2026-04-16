package com.wife.server.config;

import com.wife.server.filter.ApiSecurityFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SecurityFilterConfig {

    @Bean
    public FilterRegistrationBean<ApiSecurityFilter> apiSecurityFilter(SecurityConfig securityConfig) {
        FilterRegistrationBean<ApiSecurityFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new ApiSecurityFilter(securityConfig));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(0);
        registration.setName("apiSecurityFilter");
        return registration;
    }
}
