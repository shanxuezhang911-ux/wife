/**
 * 音频播放模块
 * 接收豆包返回的音频数据（OGG/Opus片段），实时播放
 * 同时提供音量级别用于可视化
 *
 * 策略：先尝试 decodeAudioData，失败则当 PCM 16bit 24kHz 播放
 */

let audioQueue = []       // 音频数据缓冲队列
let isPlaying = false
let volumeLevel = 0       // 0-100 当前音量级别
let volumeCallback = null

// #ifdef H5
let h5AudioContext = null
let h5GainNode = null
let h5Analyser = null
let h5AnimFrame = null
let h5NextStartTime = 0   // 下一个buffer应该开始播放的时间（无缝拼接）
// #endif

// #ifdef APP-PLUS
let innerAudioContext = null
let tempFileIndex = 0
// #endif

/**
 * 初始化播放器
 * @param {function} onVolume - (volume: 0-100) 音量变化回调
 */
export function initPlayer(onVolume) {
  volumeCallback = onVolume

  // #ifdef H5
  h5AudioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 24000
  })
  // 浏览器策略：AudioContext 初始为 suspended，需要 resume
  if (h5AudioContext.state === 'suspended') {
    h5AudioContext.resume().then(() => {
      console.log('[Player] AudioContext resumed, state=' + h5AudioContext.state)
    })
  }
  h5GainNode = h5AudioContext.createGain()
  h5Analyser = h5AudioContext.createAnalyser()
  h5Analyser.fftSize = 256
  h5Analyser.smoothingTimeConstant = 0.5
  h5GainNode.connect(h5Analyser)
  h5Analyser.connect(h5AudioContext.destination)
  h5NextStartTime = 0
  startVolumeMonitor()
  console.log('[Player] H5播放器已初始化, sampleRate=' + h5AudioContext.sampleRate)
  // #endif
}

/**
 * 收到一帧AI音频数据
 * @param {ArrayBuffer} audioData 音频数据
 */
export function feedAudio(audioData) {
  if (!audioData || audioData.byteLength === 0) return

  // #ifdef H5
  // H5: 直接调度播放，不排队等待（实现无缝拼接）
  if (h5AudioContext) {
    if (h5AudioContext.state === 'suspended') {
      h5AudioContext.resume()
    }
    playH5Immediate(audioData)
    return
  }
  // #endif

  audioQueue.push(audioData)
  if (!isPlaying) {
    playNext()
  }
}

/**
 * 停止播放并清空队列（用于用户打断）
 */
export function stopPlayback() {
  audioQueue = []
  isPlaying = false
  volumeLevel = 0

  // #ifdef H5
  h5NextStartTime = 0
  // 停止所有正在播放的source节点（通过断开gain来实现）
  if (h5GainNode && h5Analyser && h5AudioContext) {
    h5GainNode.disconnect()
    h5GainNode.connect(h5Analyser)
    h5Analyser.connect(h5AudioContext.destination)
  }
  // #endif

  // #ifdef APP-PLUS
  if (innerAudioContext) {
    try { innerAudioContext.stop() } catch (e) {}
  }
  // #endif
}

/**
 * 获取当前音量级别
 */
export function getVolume() {
  return volumeLevel
}

/**
 * 销毁播放器
 */
export function destroyPlayer() {
  stopPlayback()
  // #ifdef H5
  if (h5AnimFrame) cancelAnimationFrame(h5AnimFrame)
  if (h5AudioContext) {
    try { h5AudioContext.close() } catch (e) {}
  }
  // #endif
}

// ==================== 内部播放逻辑 ====================

function playNext() {
  if (audioQueue.length === 0) {
    isPlaying = false
    volumeLevel = 0
    return
  }

  isPlaying = true
  const data = audioQueue.shift()

  // #ifdef H5
  playH5(data)
  // #endif

  // #ifdef APP-PLUS
  playNative(data)
  // #endif
}

// ==================== H5 播放 ====================

// #ifdef H5
/**
 * H5即时播放：尝试decodeAudioData，失败则当PCM 16bit 24kHz播放
 * 使用 scheduled start time 实现无缝拼接
 */
function playH5Immediate(audioData) {
  if (!h5AudioContext) return

  // 先尝试 decodeAudioData（适用于完整OGG/Opus容器）
  const dataCopy = audioData.slice(0)
  h5AudioContext.decodeAudioData(dataCopy, (buffer) => {
    scheduleBuffer(buffer)
  }, () => {
    // 解码失败 → 当 PCM 16bit LE 24kHz 单声道
    const int16 = new Int16Array(audioData)
    if (int16.length === 0) return
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768
    }
    const buffer = h5AudioContext.createBuffer(1, float32.length, 24000)
    buffer.getChannelData(0).set(float32)
    scheduleBuffer(buffer)
  })
}

/**
 * 调度AudioBuffer在正确时间播放（无缝拼接）
 */
function scheduleBuffer(buffer) {
  if (!h5AudioContext || !h5GainNode) return
  const source = h5AudioContext.createBufferSource()
  source.buffer = buffer
  source.connect(h5GainNode)

  const now = h5AudioContext.currentTime
  const startAt = Math.max(now, h5NextStartTime)
  source.start(startAt)
  h5NextStartTime = startAt + buffer.duration

  isPlaying = true
  source.onended = () => {
    // 如果没有更多buffer排队，标记停止
    if (h5AudioContext && h5AudioContext.currentTime >= h5NextStartTime - 0.01) {
      isPlaying = false
      volumeLevel = 0
    }
  }
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
function playNative(audioData) {
  // 将音频数据写入临时文件再播放
  const fileName = `_doc/tts_${tempFileIndex++}.ogg`
  const fileWriter = plus.io.resolveLocalFileSystemURL(fileName)

  // 简化处理：用 Base64 方式
  const base64 = arrayBufferToBase64(audioData)
  const filePath = plus.io.convertLocalFileSystemURL(fileName)

  try {
    // 写入文件
    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fs) => {
      fs.root.getFile(`tts_${tempFileIndex}.ogg`, { create: true }, (entry) => {
        entry.createWriter((writer) => {
          writer.write(base64)
          writer.onwriteend = () => {
            // 播放
            if (!innerAudioContext) {
              innerAudioContext = uni.createInnerAudioContext()
              innerAudioContext.onEnded(() => {
                // 模拟音量变化
                volumeLevel = 0
                volumeCallback && volumeCallback(0)
                playNext()
              })
              innerAudioContext.onError((err) => {
                console.error('[Player] 播放错误', err)
                playNext()
              })
            }
            innerAudioContext.src = entry.toURL()
            innerAudioContext.play()

            // 模拟音量跳动
            simulateVolume()
          }
        })
      })
    })
  } catch (e) {
    console.error('[Player] 写入音频文件失败', e)
    playNext()
  }
}

function simulateVolume() {
  const interval = setInterval(() => {
    if (!isPlaying) {
      clearInterval(interval)
      volumeLevel = 0
      volumeCallback && volumeCallback(0)
      return
    }
    volumeLevel = 40 + Math.random() * 50
    volumeCallback && volumeCallback(volumeLevel)
  }, 80)
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
