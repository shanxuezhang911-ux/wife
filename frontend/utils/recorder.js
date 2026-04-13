/**
 * 麦克风录音模块
 * 采集 PCM 16kHz 16bit 单声道 音频，按20ms一包发送
 * 20ms @ 16kHz @ 16bit = 640 bytes/包
 */

let recorderManager = null
let isRecording = false
let audioCallback = null
let sequence = 0

// #ifdef H5
let h5AudioContext = null
let h5MediaStream = null
let h5ScriptNode = null
// #endif

/**
 * 开始录音，持续回调PCM数据
 * @param {function} onAudioFrame - (pcmArrayBuffer, seq) 每帧回调
 */
export function startRecording(onAudioFrame) {
  if (isRecording) return
  audioCallback = onAudioFrame
  isRecording = true
  sequence = 0

  // #ifdef APP-PLUS
  startNativeRecording()
  // #endif

  // #ifdef H5
  startH5Recording()
  // #endif
}

/**
 * 停止录音
 */
export function stopRecording() {
  isRecording = false
  audioCallback = null

  // #ifdef APP-PLUS
  if (recorderManager) {
    try { recorderManager.stop() } catch (e) {}
  }
  // #endif

  // #ifdef H5
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null }
  pcmBuffer = new Uint8Array(0)
  if (h5ScriptNode) {
    h5ScriptNode.disconnect()
    h5ScriptNode = null
  }
  if (h5MediaStream) {
    h5MediaStream.getTracks().forEach(t => t.stop())
    h5MediaStream = null
  }
  if (h5AudioContext) {
    try { h5AudioContext.close() } catch (e) {}
    h5AudioContext = null
  }
  // #endif
}

export function getIsRecording() {
  return isRecording
}

// ==================== APP原生录音 ====================

// #ifdef APP-PLUS
function startNativeRecording() {
  if (!recorderManager) {
    recorderManager = uni.getRecorderManager()
  }

  recorderManager.onFrameRecorded((res) => {
    if (!isRecording || !audioCallback) return
    if (res.frameBuffer && res.frameBuffer.byteLength > 0) {
      sequence++
      audioCallback(res.frameBuffer, sequence)
    }
  })

  recorderManager.onError((err) => {
    console.error('[Recorder] 录音错误', err)
  })

  recorderManager.start({
    duration: 600000,     // 10分钟
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 256000,
    format: 'pcm',
    frameSize: 1          // 约 1KB/帧 ≈ 62ms@16kHz
  })

  console.log('[Recorder] 原生录音已启动')
}
// #endif

// ==================== H5浏览器录音 ====================

// #ifdef H5
// PCM缓冲区，积攒到一定大小再发送，避免过于频繁的WebSocket调用
let pcmBuffer = new Uint8Array(0)
const SEND_INTERVAL_MS = 100  // 每100ms发送一次
let sendTimer = null

function startH5Recording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('[Recorder] 浏览器不支持录音（无mediaDevices）')
    isRecording = false
    return
  }

  console.log('[Recorder] 请求麦克风权限...')
  navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  }).then((stream) => {
    h5MediaStream = stream
    h5AudioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    })

    const source = h5AudioContext.createMediaStreamSource(stream)
    h5ScriptNode = h5AudioContext.createScriptProcessor(4096, 1, 1)

    h5ScriptNode.onaudioprocess = (event) => {
      if (!isRecording || !audioCallback) return

      const float32Data = event.inputBuffer.getChannelData(0)
      const targetData = resampleTo16k(float32Data, h5AudioContext.sampleRate)
      const pcm16 = float32ToPCM16(targetData)

      // 追加到缓冲区
      const newBuf = new Uint8Array(pcmBuffer.length + pcm16.byteLength)
      newBuf.set(pcmBuffer)
      newBuf.set(new Uint8Array(pcm16), pcmBuffer.length)
      pcmBuffer = newBuf
    }

    // 定时发送缓冲区数据
    sendTimer = setInterval(() => {
      if (pcmBuffer.length > 0 && isRecording && audioCallback) {
        sequence++
        audioCallback(pcmBuffer.buffer.slice(0, pcmBuffer.length), sequence)
        pcmBuffer = new Uint8Array(0)
      }
    }, SEND_INTERVAL_MS)

    source.connect(h5ScriptNode)
    h5ScriptNode.connect(h5AudioContext.destination)

    console.log('[Recorder] H5录音已启动, sampleRate=' + h5AudioContext.sampleRate)
  }).catch((err) => {
    console.error('[Recorder] 获取麦克风失败:', err.name, err.message)
    console.error('[Recorder] 提示: 请在浏览器设置中允许麦克风权限，或使用独立Chrome/Safari打开')
    isRecording = false
  })
}

/**
 * Float32 → PCM 16bit Little-Endian
 */
function float32ToPCM16(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7FFF
    view.setInt16(i * 2, s, true)  // little-endian
  }
  return buffer
}

/**
 * 简单线性重采样到16kHz
 */
function resampleTo16k(float32Array, fromRate) {
  if (fromRate === 16000) return float32Array
  const ratio = fromRate / 16000
  const newLength = Math.round(float32Array.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, float32Array.length - 1)
    const frac = srcIndex - low
    result[i] = float32Array[low] * (1 - frac) + float32Array[high] * frac
  }
  return result
}
// #endif
