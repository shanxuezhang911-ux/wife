package com.wife.server.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class Sponsor {
    private String id;
    private String deviceId;
    private String name;
    private double amount;
}
