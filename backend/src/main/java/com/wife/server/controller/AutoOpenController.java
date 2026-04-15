package com.wife.server.controller;

import com.wife.server.service.OpeningLineService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AutoOpenController {

    private final OpeningLineService openingLineService;

    /**
     *  http://localhost:8092/gm/admin.html
     * GET /api/auto-open?time_hour=N
     * APP打开时自动调用，返回攻击型开场白
     */
    @GetMapping("/auto-open")
    public Map<String, String> autoOpen(@RequestParam(value = "time_hour", required = false) Integer timeHour) {
        log.info("auto-open请求, time_hour={}", timeHour);
        String line = openingLineService.getRandomOpeningLine();
        return Map.of("text", line);
    }
}
