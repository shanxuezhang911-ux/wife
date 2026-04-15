/**
 * 豆包端到端实时语音大模型 - WebSocket 客户端
 *
 * 一个 WebSocket = ASR + LLM对话 + TTS + VAD打断，全部搞定
 *
 * 交互流程:
 *   fetchConfig → connect → StartConnection → StartSession
 *   → 持续发送麦克风PCM → 服务端VAD自动检测
 *   → ASRInfo(检测到说话) → ASRResponse(识别文本) → ASREnded(说完)
 *   → ChatResponse(AI文本) → TTSResponse(AI语音) → TTSEnded(说完)
 *   → 循环...
 *
 * 敏感配置（密钥、人设、模型参数）从后端 GET /api/config/session 拉取
 */

import CONFIG from './config.js'
import {
  encodeTextEvent,
  decodeFrame,
  EVENT,
  SERVER_EVENT,
  getEventName
} from './doubao-protocol.js'

let ws = null
let sessionId = ''
let isConnected = false
let isSessionActive = false

// 全局发送序列号（服务端对所有客户端帧统一计数，音频帧的显式sequence必须与之匹配）
let globalSequence = 0

// 从后端拉取的会话配置
let sessionConfig = null

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
  onTTSSentenceEnd: null,     // AI一句话说完（用于flush音频）
  onTTSEnd: null,             // AI全部说完了
  onBlocked: null,            // 被限流
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
 * 从后端拉取会话配置（模型、音色、人设等）
 * 必须在 connect() 之前调用
 */
export function fetchConfig() {
  return new Promise((resolve, reject) => {
    uni.request({
      url: CONFIG.API_BASE + '/api/config/session',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.data) {
          sessionConfig = res.data.data
          console.log('[Doubao] 配置已拉取, model:', sessionConfig.modelVersion, 'speaker:', sessionConfig.speaker)
          resolve(sessionConfig)
        } else {
          console.error('[Doubao] 拉取配置失败', res)
          reject(new Error('拉取配置失败'))
        }
      },
      fail: (err) => {
        console.error('[Doubao] 拉取配置网络错误', err)
        reject(err)
      }
    })
  })
}

/**
 * 获取已拉取的会话配置
 */
export function getConfig() {
  return sessionConfig
}

/**
 * 初始化并连接
 * @param {object} cbs 回调函数
 * @param {string} deviceId 设备指纹ID
 */
export function connect(cbs, deviceId) {
  callbacks = { ...callbacks, ...cbs }
  sessionId = uuid()

  const wsUrl = deviceId ? CONFIG.WS_URL + '?deviceId=' + encodeURIComponent(deviceId) : CONFIG.WS_URL
  console.log('[Doubao] 连接中...', wsUrl)

  // 所有平台统一连接后端WebSocket（密钥在后端，前端无密钥）
  // #ifdef APP-PLUS
  ws = plus.net.createWebSocket()
  ws.open(wsUrl)
  ws.onopen = onOpen
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      onBinaryMessage(event.data)
    } else if (typeof event.data === 'string') {
      onTextMessage(event.data)
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

  // #ifdef MP-WEIXIN
  ws = uni.connectSocket({
    url: wsUrl,
    header: { 'content-type': 'application/octet-stream' },
    success: () => console.log('[Doubao] 小程序WS发起连接'),
    fail: (err) => {
      console.error('[Doubao] 小程序WS连接失败', err)
      callbacks.onError && callbacks.onError(err)
    }
  })
  ws.onOpen(() => {
    console.log('[Doubao] 小程序WS已连接')
    onOpen()
  })
  ws.onMessage((res) => {
    if (res.data instanceof ArrayBuffer) {
      onBinaryMessage(res.data)
    } else if (typeof res.data === 'string') {
      onTextMessage(res.data)
    }
  })
  ws.onError((err) => {
    console.error('[Doubao] WS错误', err)
    callbacks.onError && callbacks.onError(err)
  })
  ws.onClose(() => {
    console.log('[Doubao] WS断开')
    isConnected = false
    isSessionActive = false
    callbacks.onDisconnect && callbacks.onDisconnect()
  })
  // #endif

  // #ifdef H5
  console.log('[Doubao] 连接后端:', wsUrl)
  ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'
  ws.onopen = onOpen
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      onBinaryMessage(event.data)
    } else if (typeof event.data === 'string') {
      onTextMessage(event.data)
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

/**
 * 处理服务端文本消息（限流等控制消息）
 */
function onTextMessage(data) {
  try {
    const msg = JSON.parse(data)
    if (msg.type === 'blocked') {
      console.log('[Doubao] 被限流:', msg.reason)
      callbacks.onBlocked && callbacks.onBlocked(msg)
      return
    }
    console.log('[Doubao] 收到文本消息:', data)
  } catch (e) {
    console.log('[Doubao] 收到非JSON文本:', data)
  }
}

function onOpen() {
  console.log('[Doubao] WS已连接，发送StartConnection')
  isConnected = true
  globalSequence = 0
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
      console.log('[会话] 模型:', sessionConfig?.modelVersion, '音色:', sessionConfig?.speaker)
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
      callbacks.onTTSSentenceEnd && callbacks.onTTSSentenceEnd()
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
 * 发送 StartSession 事件（使用从后端拉取的配置）
 */
function startSession() {
  if (!sessionConfig) {
    console.error('[Doubao] sessionConfig未加载，无法启动会话')
    callbacks.onError && callbacks.onError({ message: '配置未加载' })
    return
  }

  const payload = {
    tts: {
      speaker: sessionConfig.speaker,
      speed_ratio: sessionConfig.ttsSpeedRatio,
      pitch_ratio: sessionConfig.ttsPitchRatio,
      volume_ratio: sessionConfig.ttsVolumeRatio,
      audio_config: {
        format: 'pcm_s16le',
        sample_rate: 24000,
        channel: 1
      }
    },
    asr: {
      extra: {
        end_smooth_window_ms: sessionConfig.endSmoothWindowMs,
        enable_custom_vad: false,
        enable_asr_twopass: false
      }
    },
    dialog: {
      character_manifest: sessionConfig.characterManifest,
      temperature: sessionConfig.dialogTemperature,
      top_p: sessionConfig.dialogTopP,
      max_tokens: sessionConfig.dialogMaxTokens,
      frequency_penalty: sessionConfig.dialogFrequencyPenalty,
      presence_penalty: sessionConfig.dialogPresencePenalty,
      extra: {
        strict_audit: false,
        model: sessionConfig.modelVersion
      }
    }
  }

  console.log('[发送] StartSession → model=' + sessionConfig.modelVersion + ', speaker=' + sessionConfig.speaker)
  console.log('[发送] TTS: speed=' + sessionConfig.ttsSpeedRatio + ' pitch=' + sessionConfig.ttsPitchRatio)
  console.log('[发送] 人设摘要:', sessionConfig.characterManifest.substring(0, 50) + '...')
  sendBinary(encodeTextEvent(EVENT.StartSession, payload, sessionId))
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
    try {
      if (ws) {
        // #ifdef MP-WEIXIN
        ws.close({})
        // #endif
        // #ifndef MP-WEIXIN
        ws.close()
        // #endif
      }
    } catch (e) {}
    ws = null
    isConnected = false
  }, 500)
}

/**
 * 是否会话活跃
 */
export function isActive() {
  return isSessionActive
}

function sendBinary(buffer) {
  if (!ws) return
  globalSequence++
  try {
    // #ifdef APP-PLUS
    ws.send({ data: buffer })
    // #endif
    // #ifdef MP-WEIXIN
    ws.send({ data: buffer })
    // #endif
    // #ifdef H5
    ws.send(buffer)
    // #endif
  } catch (e) {
    console.error('[Doubao] 发送失败', e)
  }
}
