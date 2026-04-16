package com.wife.server.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wife.server.dto.Sponsor;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

@Service
public class SponsorService {

    private static final Logger log = LoggerFactory.getLogger(SponsorService.class);
    private static final String DATA_FILE = "data/sponsors.json";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CopyOnWriteArrayList<Sponsor> sponsors = new CopyOnWriteArrayList<>();

    @PostConstruct
    public void init() {
        load();
    }

    public List<Sponsor> getSponsors() {
        return new ArrayList<>(sponsors);
    }

    /** 前端 about 页面用，只返回名字 */
    public List<String> getSponsorNames() {
        return sponsors.stream().map(Sponsor::getName).collect(Collectors.toList());
    }

    public Sponsor addSponsor(Sponsor sponsor) {
        if (sponsor.getId() == null || sponsor.getId().isBlank()) {
            sponsor.setId(UUID.randomUUID().toString());
        }
        sponsors.add(sponsor);
        save();
        return sponsor;
    }

    public boolean removeSponsor(String id) {
        boolean removed = sponsors.removeIf(s -> s.getId().equals(id));
        if (removed) save();
        return removed;
    }

    public Sponsor updateSponsor(String id, Sponsor update) {
        for (int i = 0; i < sponsors.size(); i++) {
            if (sponsors.get(i).getId().equals(id)) {
                update.setId(id);
                sponsors.set(i, update);
                save();
                return update;
            }
        }
        return null;
    }

    private void load() {
        File file = new File(DATA_FILE);
        if (file.exists()) {
            try {
                List<Sponsor> loaded = objectMapper.readValue(file, new TypeReference<List<Sponsor>>() {});
                sponsors.addAll(loaded);
                log.info("[赞助] 加载 {} 条赞助名单", sponsors.size());
            } catch (Exception e) {
                // 兼容旧格式 List<String>
                try {
                    List<String> oldFormat = objectMapper.readValue(file, new TypeReference<List<String>>() {});
                    for (String name : oldFormat) {
                        sponsors.add(new Sponsor(UUID.randomUUID().toString(), null, name, 0));
                    }
                    log.info("[赞助] 从旧格式迁移 {} 条", sponsors.size());
                    save();
                } catch (IOException ex) {
                    log.error("[赞助] 加载失败", ex);
                }
            }
        } else {
            for (String name : List.of("阿凯", "Molly", "情是堕落的伤", "西米露", "老徐", "Jesse", "小棠")) {
                sponsors.add(new Sponsor(UUID.randomUUID().toString(), null, name, 0));
            }
            save();
        }
    }

    private void save() {
        try {
            File file = new File(DATA_FILE);
            file.getParentFile().mkdirs();
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(file, sponsors);
            log.info("[赞助] 保存 {} 条赞助名单", sponsors.size());
        } catch (IOException e) {
            log.error("[赞助] 保存失败", e);
        }
    }
}
