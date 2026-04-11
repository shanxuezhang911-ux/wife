/**
 * VAD 人声活动检测模块
 * 通过 RecorderManager 实时获取音频帧，分析音量判断是否有人说话
 */

let recorderManager = null
let vadCallback = null
let isMonitoring = false
let volumeHistory = []

// VAD 配置
const VAD_CONFIG = {
  voiceThreshold: 55,       // 音量阈值（0-100），超过视为有人声
  silenceThreshold: 25,     // 静默阈值
  voiceMinDuration: 300,    // 最少持续语音时长(ms)才触发
  silenceTimeout: 1500,     // 静默超时(ms)视为说话结束
  sampleInterval: 100       // 采样间隔(ms)
}

let voiceStartTime = 0
let lastVoiceTime = 0
let hasTriggeredVoice = false

/**
 * 开始VAD监听
 * @param {Function} onVoiceStart - 检测到人声开始的回调
 * @param {Function} onVoiceEnd - 人声结束的回调
 * @param {Function} onVolume - 音量变化回调 (volume: 0-100)
 */
export function startVAD(onVoiceStart, onVoiceEnd, onVolume) {
  if (isMonitoring) return

  vadCallback = { onVoiceStart, onVoiceEnd, onVolume }
  isMonitoring = true
  hasTriggeredVoice = false
  voiceStartTime = 0
  lastVoiceTime = 0
  volumeHistory = []

  // #ifdef APP-PLUS
  startNativeVAD()
  // #endif

  // #ifdef H5
  startH5VAD()
  // #endif
}

/**
 * 停止VAD监听
 */
export function stopVAD() {
  isMonitoring = false
  vadCallback = null
  hasTriggeredVoice = false
  volumeHistory = []

  // #ifdef APP-PLUS
  stopNativeVAD()
  // #endif

  // #ifdef H5
  stopH5VAD()
  // #endif
}

/**
 * 当前是否在监听
 */
export function isVADActive() {
  return isMonitoring
}

// ======================== APP原生实现 ========================

// #ifdef APP-PLUS
let nativeTimer = null

function startNativeVAD() {
  if (!recorderManager) {
    recorderManager = uni.getRecorderManager()
  }

  // 录音用于检测音量
  recorderManager.onFrameRecorded((res) => {
    if (!isMonitoring) return
    const volume = analyzeFrameVolume(res.frameBuffer)
    processVolume(volume)
  })

  recorderManager.onError((err) => {
    console.error('[VAD] 录音错误', err)
  })

  recorderManager.start({
    duration: 600000,     // 最长10分钟
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
    format: 'pcm',
    frameSize: 2          // 2KB每帧，约125ms@16kHz
  })
}

function stopNativeVAD() {
  if (recorderManager) {
    try { recorderManager.stop() } catch (e) {}
  }
  if (nativeTimer) {
    clearInterval(nativeTimer)
    nativeTimer = null
  }
}

function analyzeFrameVolume(buffer) {
  if (!buffer || buffer.byteLength === 0) return 0
  const dataView = new Int16Array(buffer)
  let sum = 0
  for (let i = 0; i < dataView.length; i++) {
    sum += Math.abs(dataView[i])
  }
  const avg = sum / dataView.length
  // 归一化到 0-100
  return Math.min(100, Math.round((avg / 32768) * 200))
}
// #endif

// ======================== H5浏览器实现 ========================

// #ifdef H5
let h5AudioContext = null
let h5Analyser = null
let h5MediaStream = null
let h5AnimFrame = null

function startH5VAD() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('[VAD] 浏览器不支持getUserMedia')
    return
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    h5MediaStream = stream
    h5AudioContext = new (window.AudioContext || window.webkitAudioContext)()
    const source = h5AudioContext.createMediaStreamSource(stream)
    h5Analyser = h5AudioContext.createAnalyser()
    h5Analyser.fftSize = 512
    h5Analyser.smoothingTimeConstant = 0.3
    source.connect(h5Analyser)

    pollH5Volume()
  }).catch((err) => {
    console.error('[VAD] 获取麦克风失败', err)
  })
}

function pollH5Volume() {
  if (!isMonitoring || !h5Analyser) return

  const dataArray = new Uint8Array(h5Analyser.frequencyBinCount)
  h5Analyser.getByteFrequencyData(dataArray)

  let sum = 0
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i]
  }
  const avg = sum / dataArray.length
  const volume = Math.min(100, Math.round((avg / 255) * 150))

  processVolume(volume)

  h5AnimFrame = requestAnimationFrame(pollH5Volume)
}

function stopH5VAD() {
  if (h5AnimFrame) {
    cancelAnimationFrame(h5AnimFrame)
    h5AnimFrame = null
  }
  if (h5MediaStream) {
    h5MediaStream.getTracks().forEach(t => t.stop())
    h5MediaStream = null
  }
  if (h5AudioContext) {
    try { h5AudioContext.close() } catch (e) {}
    h5AudioContext = null
  }
  h5Analyser = null
}
// #endif

// ======================== 通用音量分析逻辑 ========================

function processVolume(volume) {
  if (!isMonitoring || !vadCallback) return

  // 回调音量
  vadCallback.onVolume && vadCallback.onVolume(volume)

  const now = Date.now()
  volumeHistory.push({ time: now, volume })

  // 只保留最近2秒
  volumeHistory = volumeHistory.filter(v => now - v.time < 2000)

  if (volume >= VAD_CONFIG.voiceThreshold) {
    lastVoiceTime = now
    if (voiceStartTime === 0) {
      voiceStartTime = now
    }

    // 持续说话超过最小时长 → 触发
    if (!hasTriggeredVoice && (now - voiceStartTime) >= VAD_CONFIG.voiceMinDuration) {
      hasTriggeredVoice = true
      vadCallback.onVoiceStart && vadCallback.onVoiceStart()
    }
  } else {
    // 低于阈值
    if (hasTriggeredVoice && lastVoiceTime > 0 && (now - lastVoiceTime) >= VAD_CONFIG.silenceTimeout) {
      // 静默超时 → 说话结束
      hasTriggeredVoice = false
      voiceStartTime = 0
      lastVoiceTime = 0
      vadCallback.onVoiceEnd && vadCallback.onVoiceEnd()
    }

    if (!hasTriggeredVoice) {
      voiceStartTime = 0
    }
  }
}
