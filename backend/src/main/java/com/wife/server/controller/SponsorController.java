package com.wife.server.controller;

import com.wife.server.dto.ApiResponse;
import com.wife.server.service.SponsorService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/sponsors")
public class SponsorController {

    private final SponsorService sponsorService;

    public SponsorController(SponsorService sponsorService) {
        this.sponsorService = sponsorService;
    }

    @GetMapping
    public ApiResponse<List<String>> getSponsors() {
        return ApiResponse.ok(sponsorService.getSponsorNames());
    }
}
