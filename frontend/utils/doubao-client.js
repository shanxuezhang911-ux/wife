/**
 * 豆包端到端实时语音大模型 - WebSocket 客户端
 *
 * 一个 WebSocket = ASR + LLM对话 + TTS + VAD打断，全部搞定
 *
 * 交互流程:
 *   connect → StartConnection → StartSession → SayHello(开场白)
 *   → 持续发送麦克风PCM → 服务端VAD自动检测
 *   → ASRInfo(检测到说话) → ASRResponse(识别文本) → ASREnded(说完)
 *   → ChatResponse(AI文本) → TTSResponse(AI语音) → TTSEnded(说完)
 *   → 循环...
 */

import CONFIG from './config.js'
import {
  encodeTextEvent,
  encodeAudioFrame,
  decodeFrame,
  EVENT,
  SERVER_EVENT,
  getEventName
} from './doubao-protocol.js'

let ws = null
let sessionId = ''
let isConnected = false
let isSessionActive = false

// 当前轮次的ASR和Chat文本累积（用于日志打印）
let currentASRText = ''
let currentChatText = ''

// 回调函数集合
let callbacks = {
  onConnectionReady: null,    // 连接就绪
  onSessionStarted: null,     // 会话启动
  onAudioData: null,          // 收到AI音频数据 (ArrayBuffer)
  onASRText: null,            // 收到ASR识别文本 ({text, isInterim})
  onASRStart: null,           // 检测到用户开始说话
  onASREnd: null,             // 用户说完了
  onChatText: null,           // 收到AI回复文本
  onTTSStart: null,           // AI开始说话
  onTTSEnd: null,             // AI说完了
  onError: null,              // 错误
  onDisconnect: null          // 断开连接
}

/**
 * 生成UUID v4
 */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

/**
 * 初始化并连接
 * @param {object} cbs 回调函数
 */
export function connect(cbs) {
  callbacks = { ...callbacks, ...cbs }
  sessionId = uuid()

  console.log('[Doubao] 连接中...', CONFIG.WS_URL)

  // 所有平台统一连接代理服务器（密钥在代理端，前端无密钥）
  // #ifdef APP-PLUS
  ws = plus.net.createWebSocket()
  ws.open(CONFIG.WS_URL)
  ws.onopen = onOpen
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      onBinaryMessage(event.data)
    }
  }
  ws.onerror = (err) => {
    console.error('[Doubao] WS错误', err)
    callbacks.onError && callbacks.onError(err)
  }
  ws.onclose = () => {
    console.log('[Doubao] WS断开')
    isConnected = false
    isSessionActive = false
    callbacks.onDisconnect && callbacks.onDisconnect()
  }
  // #endif

  // #ifdef H5
  console.log('[Doubao] 连接代理:', CONFIG.WS_URL)
  ws = new WebSocket(CONFIG.WS_URL)
  ws.binaryType = 'arraybuffer'
  ws.onopen = onOpen
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      onBinaryMessage(event.data)
    }
  }
  ws.onerror = (err) => {
    console.error('[Doubao] WS错误', err)
    callbacks.onError && callbacks.onError(err)
  }
  ws.onclose = () => {
    console.log('[Doubao] WS断开')
    isConnected = false
    isSessionActive = false
    callbacks.onDisconnect && callbacks.onDisconnect()
  }
  // #endif
}

function onOpen() {
  console.log('[Doubao] WS已连接，发送StartConnection')
  isConnected = true
  // 发送 StartConnection
  sendBinary(encodeTextEvent(EVENT.StartConnection, {}, null))
}

/**
 * 处理服务端二进制消息
 */
function onBinaryMessage(data) {
  const frame = decodeFrame(data)

  if (frame.isError) {
    console.error('[Doubao] 错误帧! code=' + frame.errorCode + ', 详情:', JSON.stringify(frame.payload))
    callbacks.onError && callbacks.onError(frame.payload)
    return
  }

  switch (frame.eventId) {
    // ---- Connection ----
    case SERVER_EVENT.ConnectionStarted:
      console.log('╔══════════════════════════════╗')
      console.log('║   豆包语音大模型 连接成功     ║')
      console.log('╚══════════════════════════════╝')
      callbacks.onConnectionReady && callbacks.onConnectionReady()
      startSession()
      break

    case SERVER_EVENT.ConnectionFailed:
      console.error('[连接] 失败:', frame.payload)
      callbacks.onError && callbacks.onError(frame.payload)
      break

    // ---- Session ----
    case SERVER_EVENT.SessionStarted:
      console.log('[会话] 已启动, dialogId:', frame.payload && frame.payload.dialog_id)
      console.log('[会话] 模型:', CONFIG.MODEL_VERSION, '音色:', CONFIG.SPEAKER)
      isSessionActive = true
      callbacks.onSessionStarted && callbacks.onSessionStarted(frame.payload)
      break

    case SERVER_EVENT.SessionFinished:
      console.log('[会话] 已结束')
      isSessionActive = false
      break

    case SERVER_EVENT.SessionFailed:
      console.error('[会话] 失败:', frame.payload)
      callbacks.onError && callbacks.onError(frame.payload)
      break

    // ---- ASR ----
    case SERVER_EVENT.ASRInfo:
      currentASRText = ''
      console.log('────────────────────────────────')
      console.log('[ASR] 检测到用户开始说话...')
      callbacks.onASRStart && callbacks.onASRStart()
      break

    case SERVER_EVENT.ASRResponse:
      if (frame.payload && frame.payload.results) {
        frame.payload.results.forEach(r => {
          const text = r.text || ''
          const interim = r.is_interim || false
          if (interim) {
            console.log('[ASR] 识别中: ' + text)
          } else {
            currentASRText = text
            console.log('[ASR] 最终结果: ' + text)
          }
          callbacks.onASRText && callbacks.onASRText({ text, isInterim: interim })
        })
      }
      break

    case SERVER_EVENT.ASREnded:
      console.log('[ASR] 用户说完 → 完整文本: 「' + currentASRText + '」')
      console.log('────────────────────────────────')
      callbacks.onASREnd && callbacks.onASREnd()
      break

    // ---- TTS ----
    case SERVER_EVENT.TTSSentenceStart:
      console.log('[TTS] 开始合成语音, 类型:', frame.payload && frame.payload.tts_type || 'default')
      callbacks.onTTSStart && callbacks.onTTSStart(frame.payload)
      break

    case SERVER_EVENT.TTSResponse:
      if (frame.isAudio && frame.payload) {
        callbacks.onAudioData && callbacks.onAudioData(frame.payload)
      }
      break

    case SERVER_EVENT.TTSSentenceEnd:
      console.log('[TTS] 分句合成完毕')
      break

    case SERVER_EVENT.TTSEnded:
      console.log('[TTS] AI语音播报完成')
      console.log('════════════════════════════════')
      callbacks.onTTSEnd && callbacks.onTTSEnd(frame.payload)
      break

    // ---- Chat ----
    case SERVER_EVENT.ChatResponse:
      if (frame.payload && frame.payload.content) {
        currentChatText += frame.payload.content
        // 流式打印，不换行
        console.log('[AI] ' + frame.payload.content)
        callbacks.onChatText && callbacks.onChatText(frame.payload.content)
      }
      break

    case SERVER_EVENT.ChatEnded:
      console.log('┌──────── AI完整回复 ────────┐')
      console.log(currentChatText)
      console.log('└────────────────────────────┘')
      currentChatText = ''
      break

    // ---- 其他 ----
    case SERVER_EVENT.ConfigUpdated:
      console.log('[配置] 已更新')
      break

    case SERVER_EVENT.UsageResponse:
      if (frame.payload && frame.payload.usage) {
        const u = frame.payload.usage
        console.log('[用量] 输入文本tokens:', u.input_text_tokens,
          '输入音频tokens:', u.input_audio_tokens,
          '输出文本tokens:', u.output_text_tokens,
          '输出音频tokens:', u.output_audio_tokens)
      }
      break

    case SERVER_EVENT.ChatTextQueryConfirmed:
      console.log('[Chat] 文本Query已确认')
      break

    case SERVER_EVENT.DialogCommonError:
      console.error('[错误] 对话异常:', JSON.stringify(frame.payload))
      callbacks.onError && callbacks.onError(frame.payload)
      break

    default:
      if (frame.eventId > 0) {
        console.log('[Doubao] 未处理事件:', getEventName(frame.eventId), frame.payload)
      }
      // 可能是纯音频帧（无event的TTSResponse）
      if (frame.isAudio && frame.payload) {
        callbacks.onAudioData && callbacks.onAudioData(frame.payload)
      }
      break
  }
}

/**
 * 发送 StartSession 事件
 */
function startSession() {
  const payload = {
    tts: {
      speaker: CONFIG.SPEAKER
    },
    asr: {
      extra: {
        end_smooth_window_ms: CONFIG.END_SMOOTH_WINDOW_MS,
        enable_custom_vad: false,
        enable_asr_twopass: false
      }
    },
    dialog: {
      character_manifest: CONFIG.CHARACTER_MANIFEST,
      extra: {
        strict_audit: false,
        model: CONFIG.MODEL_VERSION
      }
    }
  }

  console.log('[发送] StartSession → model=' + CONFIG.MODEL_VERSION + ', speaker=' + CONFIG.SPEAKER)
  console.log('[发送] 人设摘要:', CONFIG.CHARACTER_MANIFEST.substring(0, 50) + '...')
  sendBinary(encodeTextEvent(EVENT.StartSession, payload, sessionId))
}

/**
 * 发送 SayHello 事件（开场白）
 * @param {string} content 开场白文本
 */
export function sayHello(content) {
  if (!isSessionActive) {
    console.warn('[Doubao] 会话未就绪，延迟发送SayHello')
    return
  }
  console.log('[发送] SayHello 开场白:')
  console.log('  「' + content + '」')
  sendBinary(encodeTextEvent(EVENT.SayHello, { content }, sessionId))
}

/**
 * 发送麦克风PCM音频帧
 * @param {ArrayBuffer} pcmData PCM音频数据
 * @param {number} sequence 帧序号（从1开始递增）
 */
export function sendAudio(pcmData, sequence) {
  if (!isSessionActive || !ws) return
  sendBinary(encodeAudioFrame(pcmData, sequence, sessionId))
}

/**
 * 发送文本消息（ChatTextQuery）
 * @param {string} text 文本内容
 */
export function sendTextQuery(text) {
  if (!isSessionActive) return
  sendBinary(encodeTextEvent(EVENT.ChatTextQuery, { content: text }, sessionId))
}

/**
 * 结束会话
 */
export function finishSession() {
  if (!isSessionActive) return
  console.log('[Doubao] 发送FinishSession')
  sendBinary(encodeTextEvent(EVENT.FinishSession, {}, sessionId))
  isSessionActive = false
}

/**
 * 断开连接
 */
export function disconnect() {
  if (!isConnected) return
  try {
    finishSession()
    sendBinary(encodeTextEvent(EVENT.FinishConnection, {}, null))
  } catch (e) {}
  setTimeout(() => {
    try { ws && ws.close() } catch (e) {}
    ws = null
    isConnected = false
  }, 500)
}

/**
 * 获取当前会话ID
 */
export function getSessionId() {
  return sessionId
}

/**
 * 是否会话活跃
 */
export function isActive() {
  return isSessionActive
}

function sendBinary(buffer) {
  if (!ws) return
  try {
    // #ifdef APP-PLUS
    ws.send({ data: buffer })
    // #endif
    // #ifdef H5
    ws.send(buffer)
    // #endif
  } catch (e) {
    console.error('[Doubao] 发送失败', e)
  }
}
