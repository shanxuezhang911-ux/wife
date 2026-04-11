/**
 * 语音模块 - TTS语音合成 + ASR语音识别
 * 自动适配 APP原生 / H5浏览器
 */

// ======================== TTS 语音合成 ========================

let ttsResolve = null
let ttsSpeaking = false

/**
 * TTS朗读文本（返回Promise，朗读完成后resolve）
 * @param {string} text 要朗读的文本
 * @returns {Promise<void>}
 */
export function speak(text) {
  return new Promise((resolve, reject) => {
    if (!text || text.trim() === '') {
      resolve()
      return
    }
    ttsResolve = resolve
    ttsSpeaking = true

    // #ifdef APP-PLUS
    plus.speech.stopSpeaking()
    plus.speech.startSpeaking({
      text: text,
      engine: 'baidu',
      speed: 6,
      pitch: 8,
      volume: 100
    }, () => {
      // 成功回调（开始朗读）
    }, (err) => {
      console.error('[TTS] 原生合成失败', err)
      ttsSpeaking = false
      ttsResolve = null
      reject(err)
    })
    // 监听播放结束
    const checkEnd = setInterval(() => {
      // plus.speech没有直接的完成回调，用轮询检测
      // 这里通过标志位控制
      if (!ttsSpeaking) {
        clearInterval(checkEnd)
      }
    }, 200)
    // 预估朗读时间后resolve（中文约5字/秒）
    const estimateMs = Math.max(2000, (text.length / 5) * 1000 + 500)
    setTimeout(() => {
      ttsSpeaking = false
      if (ttsResolve) {
        ttsResolve()
        ttsResolve = null
      }
    }, estimateMs)
    // #endif

    // #ifdef H5
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.05
      utterance.pitch = 1.2
      utterance.volume = 1.0

      // 尝试选中文女声
      const voices = window.speechSynthesis.getVoices()
      const zhVoice = voices.find(v => v.lang.includes('zh') && v.name.includes('Female')) ||
                      voices.find(v => v.lang.includes('zh-CN')) ||
                      voices.find(v => v.lang.includes('zh'))
      if (zhVoice) utterance.voice = zhVoice

      utterance.onend = () => {
        ttsSpeaking = false
        if (ttsResolve) {
          ttsResolve()
          ttsResolve = null
        }
      }
      utterance.onerror = (e) => {
        console.error('[TTS] H5合成失败', e)
        ttsSpeaking = false
        ttsResolve = null
        reject(e)
      }
      window.speechSynthesis.speak(utterance)
    } else {
      // 无TTS能力，用延时模拟
      const estimateMs = Math.max(2000, (text.length / 5) * 1000)
      setTimeout(() => {
        ttsSpeaking = false
        resolve()
      }, estimateMs)
    }
    // #endif
  })
}

/**
 * 立即停止TTS朗读
 */
export function stopSpeaking() {
  ttsSpeaking = false

  // #ifdef APP-PLUS
  try { plus.speech.stopSpeaking() } catch (e) {}
  // #endif

  // #ifdef H5
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
  // #endif

  if (ttsResolve) {
    ttsResolve()
    ttsResolve = null
  }
}

/**
 * 当前是否正在朗读
 */
export function isSpeaking() {
  return ttsSpeaking
}

// ======================== ASR 语音识别 ========================

/**
 * 启动语音识别，返回识别结果文本
 * @returns {Promise<string>} 识别出的文本
 */
export function recognizeSpeech() {
  return new Promise((resolve, reject) => {

    // #ifdef APP-PLUS
    plus.speech.startRecognize({
      engine: 'baidu',
      lang: 'zh-cn',
      timeout: 10000,
      punctuation: true
    }, (text) => {
      resolve(text || '')
    }, (err) => {
      console.error('[ASR] 原生识别失败', err)
      reject(err)
    })
    // #endif

    // #ifdef H5
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognition()
      recognition.lang = 'zh-CN'
      recognition.interimResults = false
      recognition.maxAlternatives = 1
      recognition.continuous = false

      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript
        resolve(text || '')
      }
      recognition.onerror = (event) => {
        console.error('[ASR] H5识别错误', event.error)
        if (event.error === 'no-speech') {
          resolve('')
        } else {
          reject(new Error(event.error))
        }
      }
      recognition.onend = () => {
        // 如果没有结果，静默结束
      }
      recognition.start()
    } else {
      reject(new Error('当前环境不支持语音识别'))
    }
    // #endif
  })
}

/**
 * 停止语音识别
 */
export function stopRecognize() {
  // #ifdef APP-PLUS
  try { plus.speech.stopRecognize() } catch (e) {}
  // #endif
}
