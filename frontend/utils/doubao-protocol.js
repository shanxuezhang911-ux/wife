/**
 * 豆包端到端实时语音大模型 - 二进制协议编解码
 *
 * 协议结构: [4字节header] [optional字段] [payload_size(4B)] [payload]
 *
 * header:
 *   byte0: protocol_version(4bit) | header_size(4bit)  固定 0x11
 *   byte1: message_type(4bit)     | flags(4bit)
 *   byte2: serialization(4bit)    | compression(4bit)
 *   byte3: reserved 0x00
 */

// ==================== 常量 ====================

// Message Types
const MSG_FULL_CLIENT_REQUEST = 0b0001   // 0x1 客户端文本事件
const MSG_AUDIO_ONLY_REQUEST = 0b0010    // 0x2 客户端音频数据
const MSG_FULL_SERVER_RESPONSE = 0b1001  // 0x9 服务端文本事件
const MSG_AUDIO_ONLY_RESPONSE = 0b1011   // 0xB 服务端音频数据
const MSG_ERROR = 0b1111                 // 0xF 错误

// Flags
const FLAG_EVENT = 0b0100       // 携带 event ID
const FLAG_NO_SEQ = 0b0000
const FLAG_SEQ_POSITIVE = 0b0001
const FLAG_LAST_NO_SEQ = 0b0010

// Serialization
const SERIAL_RAW = 0b0000
const SERIAL_JSON = 0b0001

// Compression
const COMPRESS_NONE = 0b0000

// 客户端事件 ID
export const EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,       // 音频上传
  UpdateConfig: 201,
  SayHello: 300,
  EndASR: 400,
  ChatTTSText: 500,
  ChatTextQuery: 501,
  ClientInterrupt: 515
}

// 服务端事件 ID
export const SERVER_EVENT = {
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  UsageResponse: 154,
  ConfigUpdated: 251,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  ASRInfo: 450,
  ASRResponse: 451,
  ASREnded: 459,
  ChatResponse: 550,
  ChatTextQueryConfirmed: 553,
  ChatEnded: 559,
  DialogCommonError: 599
}

// 事件名称映射（调试用）
const EVENT_NAMES = {}
Object.entries(SERVER_EVENT).forEach(([k, v]) => { EVENT_NAMES[v] = k })
Object.entries(EVENT).forEach(([k, v]) => { EVENT_NAMES[v] = k })

export function getEventName(id) {
  return EVENT_NAMES[id] || `Unknown(${id})`
}

// ==================== 编码 ====================

/**
 * 编码客户端文本事件 (StartConnection / StartSession / FinishSession / SayHello 等)
 * @param {number} eventId 事件ID
 * @param {object|null} jsonPayload JSON负载
 * @param {string|null} sessionId 会话ID（Session级事件必传）
 * @returns {ArrayBuffer}
 */
export function encodeTextEvent(eventId, jsonPayload, sessionId) {
  const payloadStr = jsonPayload !== null ? JSON.stringify(jsonPayload) : '{}'
  const payloadBytes = new TextEncoder().encode(payloadStr)

  // 判断是否是 Connect 级事件
  const isConnectEvent = (eventId === EVENT.StartConnection || eventId === EVENT.FinishConnection)

  // optional 字段: event(4B) + [sessionIdSize(4B) + sessionId(NB)]
  let optionalSize = 4  // event 固定4字节
  let sessionIdBytes = null
  if (!isConnectEvent && sessionId) {
    sessionIdBytes = new TextEncoder().encode(sessionId)
    optionalSize += 4 + sessionIdBytes.length  // size(4B) + content
  }

  const totalSize = 4 + optionalSize + 4 + payloadBytes.length
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let offset = 0

  // header 4 bytes
  view.setUint8(offset++, 0x11)  // version=1, headerSize=1
  view.setUint8(offset++, (MSG_FULL_CLIENT_REQUEST << 4) | FLAG_EVENT)
  view.setUint8(offset++, (SERIAL_JSON << 4) | COMPRESS_NONE)
  view.setUint8(offset++, 0x00)

  // optional: event id
  view.setUint32(offset, eventId)
  offset += 4

  // optional: session id (仅Session级事件)
  if (sessionIdBytes) {
    view.setUint32(offset, sessionIdBytes.length)
    offset += 4
    new Uint8Array(buf, offset, sessionIdBytes.length).set(sessionIdBytes)
    offset += sessionIdBytes.length
  }

  // payload size + payload
  view.setUint32(offset, payloadBytes.length)
  offset += 4
  new Uint8Array(buf, offset, payloadBytes.length).set(payloadBytes)

  return buf
}

/**
 * 编码音频数据帧 (TaskRequest事件200)
 * @param {ArrayBuffer} pcmData PCM音频数据
 * @param {number} sequence 序列号（>0 非终端，-1 最后一帧）
 * @param {string} sessionId 会话ID
 * @returns {ArrayBuffer}
 */
export function encodeAudioFrame(pcmData, sequence, sessionId) {
  const pcmBytes = new Uint8Array(pcmData)
  const sessionIdBytes = new TextEncoder().encode(sessionId)

  const isLast = sequence < 0
  const flags = FLAG_EVENT | (isLast ? FLAG_LAST_NO_SEQ : FLAG_SEQ_POSITIVE)

  // optional: sequence(4B) + event(4B) + sessionIdSize(4B) + sessionId(NB)
  const optionalSize = 4 + 4 + 4 + sessionIdBytes.length
  const totalSize = 4 + optionalSize + 4 + pcmBytes.length
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  let offset = 0

  // header
  view.setUint8(offset++, 0x11)
  view.setUint8(offset++, (MSG_AUDIO_ONLY_REQUEST << 4) | flags)
  view.setUint8(offset++, (SERIAL_RAW << 4) | COMPRESS_NONE)
  view.setUint8(offset++, 0x00)

  // optional: sequence
  view.setInt32(offset, isLast ? -1 : sequence)
  offset += 4

  // optional: event
  view.setUint32(offset, EVENT.TaskRequest)
  offset += 4

  // optional: session id
  view.setUint32(offset, sessionIdBytes.length)
  offset += 4
  new Uint8Array(buf, offset, sessionIdBytes.length).set(sessionIdBytes)
  offset += sessionIdBytes.length

  // payload
  view.setUint32(offset, pcmBytes.length)
  offset += 4
  new Uint8Array(buf, offset, pcmBytes.length).set(pcmBytes)

  return buf
}

// ==================== 解码 ====================

/**
 * 解码服务端返回的二进制帧
 * @param {ArrayBuffer} data 原始二进制数据
 * @returns {object} { messageType, eventId, eventName, payload, isAudio, isError, raw }
 */
export function decodeFrame(data) {
  const view = new DataView(data)
  const bytes = new Uint8Array(data)

  if (data.byteLength < 4) {
    return { messageType: 0, eventId: 0, eventName: 'TooShort', payload: null, isAudio: false, isError: false }
  }

  const byte0 = view.getUint8(0)
  const byte1 = view.getUint8(1)
  const messageType = (byte1 >> 4) & 0x0F
  const flags = byte1 & 0x0F
  const byte2 = view.getUint8(2)
  const serialization = (byte2 >> 4) & 0x0F

  // 仅非音频帧打印调试（音频帧太多会刷屏）
  if (messageType !== MSG_AUDIO_ONLY_RESPONSE) {
    const headerHex = Array.from(bytes.slice(0, Math.min(12, bytes.length))).map(b => b.toString(16).padStart(2, '0')).join(' ')
    console.log('[Protocol] 帧: ' + data.byteLength + 'B, type=0x' + messageType.toString(16) + ', flags=0x' + flags.toString(16) + ' [' + headerHex + ']')
  }

  const isAudio = (messageType === MSG_AUDIO_ONLY_RESPONSE)
  const isError = (messageType === MSG_ERROR)
  const isServerResponse = (messageType === MSG_FULL_SERVER_RESPONSE)

  let offset = 4
  let eventId = 0
  let errorCode = 0

  // ---- 错误帧特殊处理: header(4) + errorCode(4) + payloadSize(4) + payload ----
  if (isError) {
    if (offset + 4 <= data.byteLength) {
      errorCode = view.getUint32(offset)
      offset += 4
    }
    if (offset + 4 <= data.byteLength) {
      const payloadSize = view.getUint32(offset)
      offset += 4
      if (payloadSize > 0 && offset + payloadSize <= data.byteLength) {
        try {
          const text = new TextDecoder().decode(new Uint8Array(data, offset, payloadSize))
          payload = JSON.parse(text)
        } catch (e) {
          payload = new TextDecoder().decode(new Uint8Array(data, offset, payloadSize))
        }
      }
    }
    return {
      messageType, eventId: 0, eventName: 'Error', payload, isAudio: false, isError: true, errorCode
    }
  }

  // ---- 正常帧解析 optional 字段 ----
  // sequence
  const hasSequence = (flags & 0b0011) !== 0
  if (hasSequence) {
    if (offset + 4 <= data.byteLength) {
      offset += 4  // skip sequence
    }
  }

  // event
  const hasEvent = (flags & FLAG_EVENT) !== 0
  if (hasEvent) {
    if (offset + 4 <= data.byteLength) {
      eventId = view.getUint32(offset)
      offset += 4
    }
  }

  // session id (skip)
  if (!isAudio && offset + 4 <= data.byteLength) {
    const possibleSize = view.getUint32(offset)
    if (possibleSize > 0 && possibleSize < 200 && offset + 4 + possibleSize + 4 <= data.byteLength) {
      offset += 4 + possibleSize
    }
  }

  // payload size + payload
  let payload = null
  if (offset + 4 <= data.byteLength) {
    const payloadSize = view.getUint32(offset)
    offset += 4
    if (payloadSize > 0 && offset + payloadSize <= data.byteLength) {
      if (isAudio) {
        payload = data.slice(offset, offset + payloadSize)
      } else {
        try {
          const text = new TextDecoder().decode(new Uint8Array(data, offset, payloadSize))
          payload = JSON.parse(text)
        } catch (e) {
          payload = new TextDecoder().decode(new Uint8Array(data, offset, payloadSize))
        }
      }
    }
  }

  return {
    messageType,
    eventId,
    eventName: getEventName(eventId),
    payload,
    isAudio,
    isError,
    errorCode
  }
}
