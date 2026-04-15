package com.wife.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class WifeServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(WifeServerApplication.class, args);
    }
}
