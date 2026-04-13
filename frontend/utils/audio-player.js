/**
 * 音频播放模块
 * 接收豆包返回的 PCM 16bit LE 24kHz 单声道音频，实时播放
 * 通过 session_start 配置 audio_config.format = 'pcm' 强制返回 PCM
 */

let volumeLevel = 0
let volumeCallback = null

// #ifdef H5
let h5AudioContext = null
let h5GainNode = null
let h5Analyser = null
let h5AnimFrame = null
let h5NextStartTime = 0
// #endif

// #ifdef APP-PLUS
let innerAudioContext = null
let tempFileIndex = 0
let audioQueue = []
let isPlayingNative = false
// #endif

/**
 * 初始化播放器
 * @param {function} onVolume - (volume: 0-100) 音量变化回调
 */
export function initPlayer(onVolume) {
  volumeCallback = onVolume

  // #ifdef H5
  if (!h5AudioContext) {
    h5AudioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 24000
    })
    h5GainNode = h5AudioContext.createGain()
    h5GainNode.gain.value = 1.2  // 整体音量+20%
    h5Analyser = h5AudioContext.createAnalyser()
    h5Analyser.fftSize = 256
    h5Analyser.smoothingTimeConstant = 0.5
    h5GainNode.connect(h5Analyser)
    h5Analyser.connect(h5AudioContext.destination)
    h5NextStartTime = 0
    startVolumeMonitor()
    console.log('[Player] AudioContext 已创建, state=' + h5AudioContext.state + ', sampleRate=' + h5AudioContext.sampleRate)
  }

  // 注册全局手势监听解锁音频
  const unlock = () => {
    if (h5AudioContext && h5AudioContext.state === 'suspended') {
      h5AudioContext.resume().then(() => {
        console.log('[Player] AudioContext 已通过用户手势解锁')
      })
    }
    document.removeEventListener('touchstart', unlock, true)
    document.removeEventListener('touchend', unlock, true)
    document.removeEventListener('click', unlock, true)
  }
  document.addEventListener('touchstart', unlock, true)
  document.addEventListener('touchend', unlock, true)
  document.addEventListener('click', unlock, true)
  // #endif
}

/**
 * 收到一帧 PCM 音频数据，立即播放
 * @param {ArrayBuffer} audioData PCM 16bit LE 24kHz 单声道
 */
export function feedAudio(audioData) {
  if (!audioData || audioData.byteLength === 0) return

  // #ifdef H5
  if (h5AudioContext) {
    if (h5AudioContext.state === 'suspended') {
      h5AudioContext.resume()
    }
    playPCM(audioData)
    return
  }
  // #endif

  // #ifdef APP-PLUS
  audioQueue.push(audioData)
  if (!isPlayingNative) {
    playNextNative()
  }
  // #endif
}

/**
 * flushSentence 保留接口兼容，PCM模式下无需累积
 */
export function flushSentence() {
  // PCM 逐帧播放，无需flush
}

/**
 * 停止播放并清空队列
 */
/**
 * 等待当前缓冲音频全部播完后回调
 */
export function waitPlaybackEnd(callback) {
  // #ifdef H5
  if (!h5AudioContext || h5NextStartTime <= h5AudioContext.currentTime) {
    callback()
    return
  }
  const check = () => {
    if (!h5AudioContext || h5NextStartTime <= h5AudioContext.currentTime) {
      callback()
    } else {
      setTimeout(check, 100)
    }
  }
  setTimeout(check, 100)
  return
  // #endif

  // #ifdef APP-PLUS
  if (audioQueue.length === 0 && !isPlayingNative) {
    callback()
    return
  }
  const checkNative = () => {
    if (audioQueue.length === 0 && !isPlayingNative) {
      callback()
    } else {
      setTimeout(checkNative, 100)
    }
  }
  setTimeout(checkNative, 100)
  // #endif
}

export function stopPlayback() {
  volumeLevel = 0

  // #ifdef H5
  h5NextStartTime = 0
  if (h5GainNode && h5Analyser && h5AudioContext) {
    h5GainNode.disconnect()
    h5GainNode.connect(h5Analyser)
    h5Analyser.connect(h5AudioContext.destination)
  }
  // #endif

  // #ifdef APP-PLUS
  audioQueue = []
  isPlayingNative = false
  if (innerAudioContext) {
    try { innerAudioContext.stop() } catch (e) {}
  }
  // #endif
}

export function getVolume() {
  return volumeLevel
}

export function destroyPlayer() {
  stopPlayback()
  // #ifdef H5
  if (h5AnimFrame) cancelAnimationFrame(h5AnimFrame)
  if (h5AudioContext) {
    try { h5AudioContext.close() } catch (e) {}
    h5AudioContext = null
  }
  // #endif
}

// ==================== H5 PCM 播放 ====================

// #ifdef H5
/**
 * PCM 16bit LE → Float32 AudioBuffer → 无缝调度播放
 */
function playPCM(audioData) {
  if (!h5AudioContext || !h5GainNode) return

  const int16 = new Int16Array(audioData)
  if (int16.length === 0) return

  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768
  }

  const buffer = h5AudioContext.createBuffer(1, float32.length, 24000)
  buffer.getChannelData(0).set(float32)

  const source = h5AudioContext.createBufferSource()
  source.buffer = buffer
  source.connect(h5GainNode)

  const now = h5AudioContext.currentTime
  const startAt = Math.max(now, h5NextStartTime)
  source.start(startAt)
  h5NextStartTime = startAt + buffer.duration
}

function startVolumeMonitor() {
  if (!h5Analyser) return
  const dataArray = new Uint8Array(h5Analyser.frequencyBinCount)

  function poll() {
    if (!h5Analyser) return
    h5Analyser.getByteFrequencyData(dataArray)
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
    const avg = sum / dataArray.length
    volumeLevel = Math.min(100, Math.round((avg / 255) * 150))
    volumeCallback && volumeCallback(volumeLevel)
    h5AnimFrame = requestAnimationFrame(poll)
  }
  poll()
}
// #endif

// ==================== APP原生播放 ====================

// #ifdef APP-PLUS
function playNextNative() {
  if (audioQueue.length === 0) {
    isPlayingNative = false
    volumeLevel = 0
    volumeCallback && volumeCallback(0)
    return
  }

  isPlayingNative = true
  const data = audioQueue.shift()
  const fileName = `_doc/tts_${tempFileIndex++}.pcm`
  const base64 = arrayBufferToBase64(data)

  try {
    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fs) => {
      fs.root.getFile(`tts_${tempFileIndex}.pcm`, { create: true }, (entry) => {
        entry.createWriter((writer) => {
          writer.write(base64)
          writer.onwriteend = () => {
            if (!innerAudioContext) {
              innerAudioContext = uni.createInnerAudioContext()
              innerAudioContext.onEnded(() => {
                volumeLevel = 0
                volumeCallback && volumeCallback(0)
                playNextNative()
              })
              innerAudioContext.onError((err) => {
                console.error('[Player] 播放错误', err)
                playNextNative()
              })
            }
            innerAudioContext.src = entry.toURL()
            innerAudioContext.play()
            // 模拟音量
            const iv = setInterval(() => {
              if (!isPlayingNative) { clearInterval(iv); return }
              volumeLevel = 35 + Math.random() * 55
              volumeCallback && volumeCallback(volumeLevel)
            }, 80)
          }
        })
      })
    })
  } catch (e) {
    console.error('[Player] 写入失败', e)
    playNextNative()
  }
}

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
// #endif
