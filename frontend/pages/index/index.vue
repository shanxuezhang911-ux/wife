<template>
  <view class="container">
    <!-- 关于按钮 -->
    <view class="about-btn" @click.stop="goAbout">
      <text class="about-btn-text">?</text>
    </view>

    <!-- 波形线 -->
    <view class="wave-wrap" v-if="!ended">
      <canvas canvas-id="waveLine" id="waveLine" class="wave-canvas"></canvas>
    </view>

    <!-- 结束语 -->
    <view class="end-screen" v-if="ended" @click.stop="showEndText" @touchend.stop="showEndText">
      <text class="end-text impact-text" v-if="endTextVisible" :key="endTextKey">{{ endText }}</text>
    </view>
  </view>
</template>

<script>
import CONFIG from '../../utils/config.js'
import { secureRequest } from '../../utils/crypto.js'
import { fetchConfig, getConfig, connect, sendTextQuery, disconnect, isActive } from '../../utils/doubao-client.js'
import { initPlayer, feedAudio, flushSentence, stopPlayback, destroyPlayer, waitPlaybackEnd, collectFrame, archiveCurrentRound, replayRandom, stopReplay, clearHistory, getHistory } from '../../utils/audio-player.js'

const SILENCE_DELAY_MS = 2000

const SILENCE_FALLBACK = '[对方沉默不说话，你越想越气，积压的不满全部涌了上来]'

export default {
  data() {
    return {
      state: 'idle',
      silenceTimer: null,
      endTimer: null,
      ending: false,
      finalSent: false,
      gotFinalText: false,
      chatAccum: '',
      ended: false,
      volume: 0,
      drawTimer: null,
      maxMode: false,
      maxReplayTimer: null,
      sceneKey: '',
      roundTexts: [],
      currentRoundText: '',
      isBlocked: false,
      normalEnded: false,
      subtitleLines: [],
      subtitleLineId: 0,
      subtitleBuffer: '',
      subtitleQueue: [],
      subtitleScrollTimer: null,
      endText: '别烦我！',
      endTextKey: 0,
      endTextVisible: false,
      tapScale: false
    }
  },

  computed: {
    styledLines() {
      const total = this.subtitleLines.length
      return this.subtitleLines.map((line, idx) => {
        const fromBottom = total - 1 - idx
        let cls = 'line-active'
        if (fromBottom >= 2) cls = 'line-fade-1'
        else if (fromBottom === 1) cls = 'line-fade-2'
        return { id: line.id, text: line.text, cls }
      })
    }
  },

  watch: {
    ended(val) {
      if (val) {
        this.$nextTick(() => {
          this.endTextVisible = true
        })
      }
    }
  },

  onLoad() {
    // 生成或读取设备指纹ID
    // #ifdef MP-WEIXIN
    let deviceId = wx.getStorageSync('wife_device_id')
    if (!deviceId) {
      try {
        const info = wx.getSystemInfoSync()
        // 用稳定的设备信息拼接hash作为指纹
        const raw = (info.brand || '') + (info.model || '') + (info.system || '') + (info.screenWidth || '') + (info.screenHeight || '')
        let hash = 0
        for (let i = 0; i < raw.length; i++) {
          hash = ((hash << 5) - hash) + raw.charCodeAt(i)
          hash = hash & hash
        }
        deviceId = 'wx-' + Math.abs(hash).toString(16) + '-' + Date.now().toString(36)
      } catch (e) {
        deviceId = 'wx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      }
      wx.setStorageSync('wife_device_id', deviceId)
    }
    // #endif
    // #ifndef MP-WEIXIN
    let deviceId = uni.getStorageSync('wife_device_id')
    if (!deviceId) {
      deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
      })
      uni.setStorageSync('wife_device_id', deviceId)
    }
    // #endif
    this.deviceId = deviceId
    console.log('[启动] deviceId:', deviceId)
  },

  onReady() {
    this._sessionStarted = true
    this.initSession()
  },

  onShow() {
    if (this._navigatingAway) return
    // 首次加载时onShow先于onReady执行，此时不应初始化
    if (!this._sessionStarted) return
    // 从后台恢复：已结束 或 豆包已断开 → 全部重来
    if (this.ended || !isActive()) {
      console.log('[启动] onShow重新初始化, ended=' + this.ended + ', isActive=' + isActive())
      this.cleanup()
      this.resetState()
      this.initSession()
    }
  },

  onUnload() { this.cleanup() },
  onHide() {
    // 跳转about页面不清理，只有真正退出小程序才清理
    if (this._navigatingAway) return
    this.cleanup()
    this.ended = true
  },

  methods: {
    resetState() {
      this.state = 'idle'
      this.ending = false
      this.finalSent = false
      this.gotFinalText = false
      this.chatAccum = ''
      this.ended = false
      this.volume = 0
      this.maxMode = false
      this.sceneKey = ''
      this.roundTexts = []
      this.currentRoundText = ''
      this.isBlocked = false
      this.normalEnded = false
      this.subtitleLines = []
      this.subtitleBuffer = ''
      this.subtitleQueue = []
      this.endTextVisible = false
      this.endTextKey = 0
    },

    initSession() {
      uni.setKeepScreenOn({ keepScreenOn: true })
      if (!this.drawTimer) this.startDraw()
      fetchConfig().then(() => {
        const cfg = getConfig()
        console.log('[启动] 模型:', cfg.modelVersion, '音色:', cfg.speaker, '缓存模式:', cfg.cacheMode)
        if (cfg.cacheMode) {
          this.tryCacheOrLive()
        } else {
          this.startVoiceSession()
        }
      }).catch((err) => {
        console.error('[启动] 拉取配置失败', err)
        // #ifdef MP-WEIXIN
        uni.showModal({
          title: '连接失败',
          content: '无法连接服务器，请检查网络。非调试模式需HTTPS+域名。',
          showCancel: false
        })
        // #endif
        this.ended = true
      })
    },

    showEndText() {
      // 每次点击：销毁旧元素 → 重建 → 重新触发动画
      this.endTextVisible = false
      this.$nextTick(() => {
        this.endTextKey++
        this.endTextVisible = true
      })
    },

    goAbout() {
      this._navigatingAway = true
      uni.navigateTo({
        url: '/pages/about/about',
        complete: () => {
          setTimeout(() => { this._navigatingAway = false }, 500)
        }
      })
    },

    toggleMax() {
      this.maxMode = !this.maxMode
      console.log('[Main] Max模式:', this.maxMode ? 'ON' : 'OFF')
      if (!this.maxMode) {
        this.clearMaxReplayTimer()
        stopReplay()
      }
    },

    clearMaxReplayTimer() {
      if (this.maxReplayTimer) { clearTimeout(this.maxReplayTimer); this.maxReplayTimer = null }
    },

    // ==================== 字幕系统 ====================

    pushSubtitleLine(text) {
      if (!text) return
      this.subtitleLineId++
      this.subtitleLines.push({ text, id: this.subtitleLineId })
      if (this.subtitleLines.length > 5) {
        this.subtitleLines.splice(0, this.subtitleLines.length - 5)
      }
      this.resetScrollTimer()
    },

    showNextSubtitle() {
      if (this.subtitleQueue.length === 0) return
      this.pushSubtitleLine(this.subtitleQueue.shift())
    },

    // 没有新文字时，3s自动向上滚动（移除最旧一行）
    resetScrollTimer() {
      this.clearScrollTimer()
      this.subtitleScrollTimer = setInterval(() => {
        if (this.subtitleLines.length > 0) {
          this.subtitleLines.splice(0, 1)
        }
        if (this.subtitleLines.length === 0) {
          this.clearScrollTimer()
        }
      }, 3000)
    },

    clearScrollTimer() {
      if (this.subtitleScrollTimer) {
        clearInterval(this.subtitleScrollTimer)
        this.subtitleScrollTimer = null
      }
    },

    // 过滤括号内容，按标点拆句
    splitAndQueue(text) {
      // 去掉 [...] 和 （...） 和 (...) 内容
      const cleaned = text.replace(/[\[【（(][^\]】）)]*[\]】）)]/g, '')
      this.subtitleBuffer += cleaned
      const segs = this.subtitleBuffer.split(/(?<=[，。！？、；,.!?…])/)
      if (segs.length > 1) {
        for (let i = 0; i < segs.length - 1; i++) {
          const seg = segs[i].trim()
          if (seg) this.subtitleQueue.push(seg)
        }
        this.subtitleBuffer = segs[segs.length - 1]
      }
    },

    // ==================== 波形绘制 ====================

    startDraw() {
      const ctx = uni.createCanvasContext('waveLine', this)
      // 获取画布实际尺寸（rpx转px近似）
      const W = uni.getSystemInfoSync().windowWidth
      const H = 120

      const draw = () => {
        ctx.clearRect(0, 0, W, H)
        const mid = H / 2
        const nv = this.volume / 100
        const time = Date.now() / 1000

        // 主线
        ctx.beginPath()
        ctx.setLineWidth(2)
        ctx.setStrokeStyle(this.state === 'ai_speaking'
          ? 'rgba(233,69,96,0.7)'
          : 'rgba(180,180,200,0.4)')

        for (let x = 0; x < W; x++) {
          const ratio = x / W
          // 多频叠加
          const baseAmp = 2
          const wave1 = Math.sin(ratio * 8 + time * 3) * (baseAmp + nv * 33)
          const wave2 = Math.sin(ratio * 12 + time * 5) * (nv * 15)
          const wave3 = Math.sin(ratio * 20 + time * 7) * (nv * 8)
          // 边缘衰减
          const edge = Math.sin(ratio * Math.PI)
          const y = mid + (wave1 + wave2 + wave3) * edge

          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()

        // AI说话时加一条细辉光线
        if (this.state === 'ai_speaking' && nv > 0.05) {
          ctx.beginPath()
          ctx.setLineWidth(4)
          ctx.setStrokeStyle('rgba(233,69,96,0.12)')
          for (let x = 0; x < W; x++) {
            const ratio = x / W
            const wave = Math.sin(ratio * 8 + time * 3) * nv * 35 * Math.sin(ratio * Math.PI)
            const y = mid + wave
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }

        ctx.draw()
      }

      this.drawTimer = setInterval(draw, 50)
    },

    // ==================== 核心流程 ====================

    startVoiceSession() {
      this.state = 'connecting'

      initPlayer((vol) => {
        this.volume = vol
      })

      connect({
        onConnectionReady: () => {},

        onBlocked: (msg) => {
          console.log('[Main] 被限流，显示滚')
          this.isBlocked = true
          this.ended = true
          this.cleanup()
        },

        onSessionStarted: (data) => {
          this.state = 'processing'
          // 从后端获取开场情景
          secureRequest({
            url: CONFIG.API_BASE + '/api/config/opening',
            method: 'GET',
            success: (res) => {
              const scene = (res.data && res.data.data) || '[你看着对方沉默不语，积攒的情绪开始翻涌]'
              this.sceneKey = scene
              sendTextQuery(scene)
            },
            fail: () => {
              const scene = '[你看着对方沉默不语，积攒的情绪开始翻涌]'
              this.sceneKey = scene
              sendTextQuery(scene)
            }
          })
          // 启动超时定时器
          this.startEndTimer()
        },

        onAudioData: (audioBuffer) => {
          feedAudio(audioBuffer)
          collectFrame(audioBuffer)
          if (this.state !== 'ai_speaking') this.state = 'ai_speaking'
        },

        onASRStart: () => {},
        onASRText: () => {},
        onASREnd: () => {},

        onTTSSentenceEnd: () => {
          flushSentence()
          // 一句TTS音频发送完 → 显示下一条字幕
          this.showNextSubtitle()
        },

        onChatText: (text) => {
          this.currentRoundText += text
          // 拆句入队（自动过滤括号内容）
          this.splitAndQueue(text)
          // 发送了最后一句后，监听AI文本内容是否包含"滚"
          if (this.finalSent) {
            this.chatAccum += text
            if (this.chatAccum.includes('滚')) {
              console.log('[Main] 检测到AI说了"滚"，标记结束')
              this.gotFinalText = true
            }
          }
        },

        onTTSStart: (data) => {
          this.clearSilenceTimer()
          this.clearMaxReplayTimer()
          this.currentRoundText = ''
          this.subtitleBuffer = ''
          this.subtitleQueue = []
          this.clearScrollTimer()
          this.state = 'ai_speaking'
        },

        onTTSEnd: (data) => {
          this.state = 'listening'
          this.volume = 0
          // 把剩余buffer入队并显示
          if (this.subtitleBuffer.trim()) {
            this.subtitleQueue.push(this.subtitleBuffer.trim())
            this.subtitleBuffer = ''
          }
          while (this.subtitleQueue.length > 0) {
            this.showNextSubtitle()
          }
          archiveCurrentRound()
          this.roundTexts.push(this.currentRoundText)
          this.currentRoundText = ''
          // AI已说出"滚" → 等所有缓冲音频播完 → 显示滚 → 结束
          if (this.gotFinalText) {
            if (this._finalSafetyTimer) { clearTimeout(this._finalSafetyTimer); this._finalSafetyTimer = null }
            this.normalEnded = true
            waitPlaybackEnd(() => {
              stopReplay()
              this.uploadCache()
              this.ended = true
              this.cleanup()
            })
            return
          }
          // Max复播：6s后随机播一段历史
          if (this.maxMode) {
            this.clearMaxReplayTimer()
            this.maxReplayTimer = setTimeout(() => {
              if (this.maxMode && !this.ended) replayRandom()
            }, 6000)
          }
          // 正常循环（内部判断ending，发最后一句）
          this.scheduleSilencePrompt()
        },

        onError: (err) => {
          console.error('[错误]', err)
          this.state = 'listening'
          this.scheduleSilencePrompt()
        },

        onDisconnect: () => {
          this.state = 'idle'
          this.clearSilenceTimer()
        }
      }, this.deviceId)
    },

    scheduleSilencePrompt() {
      this.clearSilenceTimer()
      // 超时且还没发过最后一句 → 发结束语
      if (this.ending && !this.finalSent) {
        this.finalSent = true
        this.chatAccum = ''
        console.log('[Main] 发送结束语')
        sendTextQuery('[你受够了，用最狠最绝望的一句话结束这场对话，最后说"你滚吧"然后不再说话]')
        this.state = 'processing'
        // 兜底：20秒AI没说出"滚"就直接结束
        this._finalSafetyTimer = setTimeout(() => {
          if (!this.ended) {
            console.log('[Main] 结束语超时兜底')
            this.ended = true
            this.cleanup()
          }
        }, 20000)
        return
      }
      // 已发过结束语，等AI说完（不再发新内容）
      if (this.finalSent) return
      // 正常沉默循环
      this.silenceTimer = setTimeout(() => {
        if (!isActive() || this.ending) return
        secureRequest({
          url: CONFIG.API_BASE + '/api/config/silence',
          method: 'GET',
          success: (res) => {
            if (!isActive() || this.ending) return
            const ctx = (res.data && res.data.data) || SILENCE_FALLBACK
            console.log('[Main] 发送沉默语境:', ctx)
            sendTextQuery(ctx)
            this.state = 'processing'
          },
          fail: () => {
            if (!isActive() || this.ending) return
            sendTextQuery(SILENCE_FALLBACK)
            this.state = 'processing'
          }
        })
      }, SILENCE_DELAY_MS)
    },

    clearSilenceTimer() {
      if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null }
    },

    // ==================== 缓存上报 ====================

    uploadCache() {
      if (!this.normalEnded || this.isBlocked || !this.sceneKey) return
      const history = getHistory()
      if (!history || history.length === 0) return

      const rounds = []
      for (let i = 0; i < history.length; i++) {
        const text = this.roundTexts[i] || ''
        const audioBase64 = this.arrayBufferToBase64(history[i])
        rounds.push({ text, audioBase64 })
      }

      console.log('[Main] 上报缓存, sceneKey:', this.sceneKey.substring(0, 30), '共', rounds.length, '轮')
      secureRequest({
        url: CONFIG.API_BASE + '/api/cache/upload',
        method: 'POST',
        header: {
          'content-type': 'application/json',
          'X-Device-Id': this.deviceId
        },
        data: { sceneKey: this.sceneKey, rounds },
        success: (res) => console.log('[Main] 缓存上报成功', res.data),
        fail: (err) => console.error('[Main] 缓存上报失败', err)
      })
    },

    arrayBufferToBase64(buffer) {
      // #ifdef MP-WEIXIN
      return uni.arrayBufferToBase64(buffer)
      // #endif
      // #ifdef H5
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
      }
      return btoa(binary)
      // #endif
      // #ifdef APP-PLUS
      return uni.arrayBufferToBase64(buffer)
      // #endif
    },

    // ==================== 缓存回放模式 ====================

    tryCacheOrLive() {
      // 先尝试从服务端获取缓存（服务端决定概率+去重）
      secureRequest({
        url: CONFIG.API_BASE + '/api/cache/random',
        method: 'GET',
        header: { 'X-Device-Id': this.deviceId },
        success: (res) => {
          if (res.statusCode === 200 && res.data && res.data.code === 0 && res.data.data) {
            console.log('[Main] 服务端分配缓存回放')
            this.startCachePlayback(res.data.data)
          } else {
            console.log('[Main] 服务端未分配缓存，走实时模式')
            this.startVoiceSession()
          }
        },
        fail: () => {
          console.log('[Main] 请求缓存失败，走实时模式')
          this.startVoiceSession()
        }
      })
    },

    startCachePlayback(cache) {
      const rounds = cache.rounds || []
      console.log('[Main] 缓存回放启动, sceneKey:', (cache.sceneKey || '').substring(0, 30), '共', rounds.length, '轮')
      this.state = 'processing'

      initPlayer((vol) => {
        this.volume = vol
      })

      this.playCacheRounds(rounds, 0)
    },

    playCacheRounds(rounds, index) {
      if (index >= rounds.length || this.ended) {
        // 全部播完，显示"滚"
        waitPlaybackEnd(() => {
          this.ended = true
          this.cleanup()
        })
        return
      }

      const round = rounds[index]
      if (!round.audioBase64) {
        this.playCacheRounds(rounds, index + 1)
        return
      }

      this.state = 'ai_speaking'
      this.subtitleLines = []
      this.clearScrollTimer()
      // 按标点拆字幕，过滤括号，定时轮播
      const cacheSubtitles = []
      if (round.text) {
        const cleaned = round.text.replace(/[\[【（(][^\]】）)]*[\]】）)]/g, '')
        const segs = cleaned.split(/(?<=[，。！？、；,.!?…])/)
        for (const s of segs) { if (s.trim()) cacheSubtitles.push(s.trim()) }
      }
      const pcmData = this.base64ToArrayBuffer(round.audioBase64)
      const totalDurationMs = (pcmData.byteLength / (24000 * 2)) * 1000
      const segInterval = cacheSubtitles.length > 0 ? totalDurationMs / cacheSubtitles.length : 0
      let segIdx = 0
      let segTimer = null
      if (cacheSubtitles.length > 0) {
        this.pushSubtitleLine(cacheSubtitles[0])
        segIdx = 1
        if (cacheSubtitles.length > 1) {
          segTimer = setInterval(() => {
            if (segIdx < cacheSubtitles.length) {
              this.pushSubtitleLine(cacheSubtitles[segIdx])
              segIdx++
            } else {
              clearInterval(segTimer)
            }
          }, segInterval)
        }
      }

      // 分帧喂入播放器（每帧 2400 samples = 100ms @24kHz）
      const frameSize = 2400 * 2 // 16bit = 2 bytes per sample
      let offset = 0
      const feedInterval = setInterval(() => {
        if (offset >= pcmData.byteLength || this.ended) {
          clearInterval(feedInterval)
          if (segTimer) clearInterval(segTimer)
          // 当前轮播完，等音频flush后播下一轮
          waitPlaybackEnd(() => {
            this.state = 'listening'
            this.volume = 0
            this.subtitleLines = []
            // 轮间间隔 1-2s
            setTimeout(() => {
              this.playCacheRounds(rounds, index + 1)
            }, 1000 + Math.random() * 1000)
          })
          return
        }
        const end = Math.min(offset + frameSize, pcmData.byteLength)
        const frame = pcmData.slice(offset, end)
        feedAudio(frame)
        offset = end
      }, 100)
    },

    base64ToArrayBuffer(base64) {
      // #ifdef MP-WEIXIN
      return uni.base64ToArrayBuffer(base64)
      // #endif
      // #ifdef H5
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
      // #endif
      // #ifdef APP-PLUS
      return uni.base64ToArrayBuffer(base64)
      // #endif
    },

    // ==================== 超时结束 ====================

    startEndTimer() {
      const cfg = getConfig()
      const timeoutMin = cfg ? cfg.timeoutMinutes : 5
      const ms = timeoutMin * 60 * 1000
      console.log('[Main] 会话将在', timeoutMin, '分钟后结束')
      this.endTimer = setTimeout(() => {
        console.log('[Main] 超时，标记ending')
        this.ending = true
        this.clearSilenceTimer()
        // 如果当前空闲，走scheduleSilencePrompt发结束语
        if (this.state === 'listening' || this.state === 'idle') {
          this.scheduleSilencePrompt()
        }
        // 如果ai_speaking或processing，等onTTSEnd自然触发scheduleSilencePrompt
      }, ms)
    },

    clearEndTimer() {
      if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null }
    },

    cleanup() {
      if (this.drawTimer) { clearInterval(this.drawTimer); this.drawTimer = null }
      this.clearSilenceTimer()
      this.clearEndTimer()
      this.clearMaxReplayTimer()
      this.clearScrollTimer()
      stopReplay()
      clearHistory()
      stopPlayback()
      destroyPlayer()
      disconnect()
      uni.setKeepScreenOn({ keepScreenOn: false })
    }
  }
}
</script>

<style scoped>
.container {
  width: 100vw;
  height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.subtitle-wrap {
  width: 100%;
  padding: 0 48rpx;
  min-height: 280rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  overflow: hidden;
}
.subtitle-line {
  width: 100%;
  text-align: center;
  margin-bottom: 16rpx;
  transition: opacity 0.8s ease;
  animation: slide-up 0.4s ease-out;
}
.subtitle-text {
  font-size: 26rpx;
  color: rgba(0, 0, 0, 0.6);
  font-family: "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  line-height: 1.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line-active {
  opacity: 1;
}
.line-fade-2 {
  opacity: 0.3;
}
.line-fade-1 {
  opacity: 0.1;
}
@keyframes slide-up {
  0%   { transform: translateY(30rpx); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

.wave-wrap {
  width: 100%;
  height: 240rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wave-canvas {
  width: 100%;
  height: 240rpx;
}

.about-btn {
  position: fixed;
  right: 36rpx;
  bottom: 60rpx;
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid rgba(0, 0, 0, 0.08);
  z-index: 20;
}
.about-btn:active {
  background: rgba(0, 0, 0, 0.1);
  transform: scale(0.96);
}
.about-btn-text {
  font-size: 26rpx;
  color: rgba(0, 0, 0, 0.4);
  font-weight: 500;
}

.end-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.end-text {
  font-size: 100rpx;
  color: #e94560;
  font-weight: 300;
  font-family: "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  letter-spacing: 8rpx;
}
.impact-text {
  animation: impact-pop 2.5s ease-out forwards;
}
@keyframes impact-pop {
  0%   { transform: scale(1.8); opacity: 0; }
  15%  { transform: scale(0.95); opacity: 1; }
  25%  { transform: scale(1); opacity: 1; }
  45%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1); }
}
</style>
