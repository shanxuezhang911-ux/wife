# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"婚后窒息" (Post-Marriage Suffocation) — a real-time voice conversational AI app with an aggressive "wife" persona. Three components work together: a uni-app frontend captures voice and plays audio, a Node.js WebSocket proxy authenticates with 豆包 (Bytedance) speech API, and a Spring Boot backend enriches chat with time-based mood/persona context.

## Build & Run Commands

### Backend (Spring Boot 3.2.5 / Java 17 / Gradle)
```bash
cd backend
./gradlew clean build        # Build jar to build/libs/wife-server-1.0.0.jar
./gradlew bootRun            # Run dev server on port 8091
```

### Frontend (uni-app / Vue.js)
```bash
cd frontend
npm install
npm run dev:h5               # Dev server on port 5173
npm run build:h5             # Production build for H5
npm run build:app            # Android APK (requires HBuilder)
```

### Proxy (Node.js WebSocket)
```bash
cd proxy
npm install
node server.js               # WebSocket proxy on port 9090
```

All three services must be running for full functionality.

## Architecture

**Data flow:** Microphone → Frontend (PCM 16kHz) → WebSocket binary frames → Proxy (:9090) → 豆包 API (ASR+LLM+TTS) → Proxy → Frontend → Audio playback

**Backend flow:** Frontend calls `POST /api/chat/stream` → ChatController → ChatService → SystemPromptBuilder (persona + TimeStateService mood) → GptStreamService (SSE stream to OpenAI-compatible API)

### Backend (`backend/`) — port 8091
- `SystemPromptBuilder.java` — Constructs the full system prompt with persona definition and time-based mood context. This is the core character logic.
- `TimeStateService.java` — Maps time-of-day to mood states (MORNING_GRUMPY, NOON_COOKING, AFTERNOON_LAUNDRY, EVENING_EXHAUSTED, NIGHT_BREAKDOWN) injected into prompts.
- `GptStreamService.java` — HTTP streaming client for OpenAI-compatible API. Parses both standard OpenAI and custom "responses API" SSE formats.
- `ChatService.java` — Orchestrates streaming chat, wiring prompt building to API calls via SseEmitter.
- Key endpoints: `POST /api/chat/stream` (SSE), `GET /api/chat/opening`, `GET /api/chat/mood`

### Frontend (`frontend/`) — port 5173
- `pages/index/index.vue` — Single-page app with state machine (idle/connecting/ai_speaking/listening/user_speaking/processing) and 40-bar audio visualizer.
- `utils/doubao-client.js` — WebSocket client managing connection lifecycle and event dispatching.
- `utils/doubao-protocol.js` — Custom binary protocol encoder/decoder for 豆包 API frames (4-byte headers, optional fields, payloads).
- `utils/recorder.js` — Platform-specific mic capture (APP: native RecorderManager, H5: Web Audio API). Outputs PCM 16kHz 16bit mono in 20ms frames.
- `utils/audio-player.js` — Platform-specific playback with Ogg/Opus decoding and volume monitoring for visualization.
- `utils/config.js` — Central config for WebSocket URL, model version, speaker voice, character manifest, audio format settings.

### Proxy (`proxy/`) — port 9090
- `server.js` — Stateless WebSocket relay. Injects auth headers for 豆包 API (`wss://openspeech.bytedance.com`), buffers messages during upstream handshake.

## Key Technical Details

- **No database** — entirely stateless chat architecture, no persistence layer.
- **No tests** — no test files exist in backend or frontend.
- **No CI/CD** — manual builds and deployments only.
- **Cross-platform** — uni-app targets H5 and Android; platform-specific code in recorder.js and audio-player.js uses `// #ifdef` conditional compilation.
- **Streaming throughout** — SSE for backend chat responses, WebSocket binary frames for voice.
- Backend AI config in `application.yml` points to `https://lumos.diandian.info/winky/openai/v1/responses`.
- Frontend WebSocket target configured in `utils/config.js` (default: `ws://10.0.49.94:9090`).
