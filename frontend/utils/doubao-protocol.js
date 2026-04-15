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

// ==================== TextEncoder/TextDecoder polyfill (微信小程序) ====================

function getTextEncoder() {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder()
  return {
    encode(str) {
      const utf8 = []
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i)
        if (code < 0x80) {
          utf8.push(code)
        } else if (code < 0x800) {
          utf8.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
        } else if (code >= 0xD800 && code <= 0xDBFF) {
          const hi = code
          const lo = str.charCodeAt(++i)
          code = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
          utf8.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
        } else {
          utf8.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
        }
      }
      return new Uint8Array(utf8)
    }
  }
}

function getTextDecoder() {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder()
  return {
    decode(uint8arr) {
      const bytes = uint8arr instanceof Uint8Array ? uint8arr : new Uint8Array(uint8arr)
      let str = ''
      for (let i = 0; i < bytes.length;) {
        const b = bytes[i]
        if (b < 0x80) {
          str += String.fromCharCode(b); i++
        } else if ((b & 0xE0) === 0xC0) {
          str += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)); i += 2
        } else if ((b & 0xF0) === 0xE0) {
          str += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)); i += 3
        } else if ((b & 0xF8) === 0xF0) {
          const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F)
          const surr = cp - 0x10000
          str += String.fromCharCode(0xD800 + (surr >> 10), 0xDC00 + (surr & 0x3FF)); i += 4
        } else {
          i++
        }
      }
      return str
    }
  }
}

const textEncoder = getTextEncoder()
const textDecoder = getTextDecoder()

// ==================== 常量 ====================

// Message Types
const MSG_FULL_CLIENT_REQUEST = 0b0001   // 0x1 客户端文本事件
const MSG_FULL_SERVER_RESPONSE = 0b1001  // 0x9 服务端文本事件
const MSG_AUDIO_ONLY_RESPONSE = 0b1011   // 0xB 服务端音频数据
const MSG_ERROR = 0b1111                 // 0xF 错误

// Flags
const FLAG_EVENT = 0b0100       // 携带 event ID

// Serialization
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
  const payloadBytes = textEncoder.encode(payloadStr)

  // 判断是否是 Connect 级事件
  const isConnectEvent = (eventId === EVENT.StartConnection || eventId === EVENT.FinishConnection)

  // optional 字段: event(4B) + [sessionIdSize(4B) + sessionId(NB)]
  let optionalSize = 4  // event 固定4字节
  let sessionIdBytes = null
  if (!isConnectEvent && sessionId) {
    sessionIdBytes = textEncoder.encode(sessionId)
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
          const text = textDecoder.decode(new Uint8Array(data, offset, payloadSize))
          payload = JSON.parse(text)
        } catch (e) {
          payload = textDecoder.decode(new Uint8Array(data, offset, payloadSize))
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

  // session id (skip) — 音频帧和文本帧都可能携带 session id
  if (offset + 4 <= data.byteLength) {
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
          const text = textDecoder.decode(new Uint8Array(data, offset, payloadSize))
          payload = JSON.parse(text)
        } catch (e) {
          payload = textDecoder.decode(new Uint8Array(data, offset, payloadSize))
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
