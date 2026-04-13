<template>
  <view class="container" @click="handleTap">
    <!-- 波形线 -->
    <view class="wave-wrap">
      <canvas canvas-id="waveLine" id="waveLine" class="wave-canvas"></canvas>
    </view>

    <!-- 超时结束 -->
    <view class="end-screen" v-if="ended">
      <text class="end-text">滚</text>
    </view>
  </view>
</template>

<script>
import CONFIG from '../../utils/config.js'
import { connect, sendTextQuery, disconnect, isActive } from '../../utils/doubao-client.js'
import { initPlayer, feedAudio, flushSentence, stopPlayback, destroyPlayer, waitPlaybackEnd } from '../../utils/audio-player.js'
import { getOpeningLine } from '../../utils/opening.js'

const SILENCE_DELAY_MS = 2000

const SILENCE_CONTEXTS = [
  '[对方沉默不说话，似乎在躲避你，你越想越气，从今天的事联想到一直以来积压的不满]',
  '[对方一直没回应，冷冷地看着你，你感到被无视的愤怒涌上来，忍不住开始数落这些年的委屈]',
  '[对方叹了口气还是不开口，你觉得这种态度比吵架更让人崩溃，所有的失望一下子涌了出来]',
  '[对方低头玩手机完全无视你，你气得发抖，开始质问这段关系到底还有没有意义]',
  '[对方翻了个白眼一句话不说，你被这个表情彻底激怒，积攒的情绪全面爆发]',
  '[安静了好几秒对方没有任何反应，这种冷暴力让你想起无数个类似的夜晚，越想越心寒]',
  '[对方假装没听见继续做自己的事，你觉得自己在这个家里就是透明的，所有的付出都不被看见]',
  '[对方的沉默让你想起结婚前后的落差，从期待到失望再到绝望，一幕幕在脑海里翻涌]',
  '[对方不理你让你想起上次大吵的场景，那些没说完的话现在全部堵在嗓子里要喷出来]',
  '[对方的冷漠让你突然很想哭但又咽了回去，化悲为怒开始细数这些年受的委屈]'
]

export default {
  data() {
    return {
      state: 'idle',
      started: false,
      silenceTimer: null,
      endTimer: null,
      ending: false,
      finalSent: false,
      gotFinalText: false,
      chatAccum: '',
      ended: false,
      volume: 0,
      drawTimer: null
    }
  },

  onLoad() {
    console.log('[启动] 模型:', CONFIG.MODEL_VERSION, '音色:', CONFIG.SPEAKER)
  },

  onReady() {
    this.startDraw()
    this.started = true
    this.startVoiceSession()
  },

  onUnload() { this.cleanup() },
  onHide() { this.cleanup() },

  methods: {
    handleTap() {},

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
          ? 'rgba(233,69,96,0.9)'
          : 'rgba(100,100,140,0.4)')

        for (let x = 0; x < W; x++) {
          const ratio = x / W
          // 多频叠加
          const wave1 = Math.sin(ratio * 8 + time * 3) * nv * 35
          const wave2 = Math.sin(ratio * 12 + time * 5) * nv * 15
          const wave3 = Math.sin(ratio * 20 + time * 7) * nv * 8
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
          ctx.setStrokeStyle('rgba(233,69,96,0.15)')
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

        onSessionStarted: (data) => {
          const scene = getOpeningLine()
          this.state = 'processing'
          sendTextQuery(scene)
          // 启动超时定时器
          this.startEndTimer()
        },

        onAudioData: (audioBuffer) => {
          feedAudio(audioBuffer)
          if (this.state !== 'ai_speaking') this.state = 'ai_speaking'
        },

        onASRStart: () => {},
        onASRText: () => {},
        onASREnd: () => {},

        onTTSSentenceEnd: () => { flushSentence() },

        onChatText: (text) => {
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
          this.state = 'ai_speaking'
        },

        onTTSEnd: (data) => {
          this.state = 'listening'
          this.volume = 0
          // AI已说出"滚" → 等所有缓冲音频播完 → 显示滚 → 结束
          if (this.gotFinalText) {
            if (this._finalSafetyTimer) { clearTimeout(this._finalSafetyTimer); this._finalSafetyTimer = null }
            waitPlaybackEnd(() => {
              this.ended = true
              this.cleanup()
            })
            return
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
          this.started = false
          this.clearSilenceTimer()
        }
      })
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
        const ctx = SILENCE_CONTEXTS[Math.floor(Math.random() * SILENCE_CONTEXTS.length)]
        console.log('[Main] 发送沉默语境:', ctx)
        sendTextQuery(ctx)
        this.state = 'processing'
      }, SILENCE_DELAY_MS)
    },

    clearSilenceTimer() {
      if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null }
    },

    // ==================== 超时结束 ====================

    startEndTimer() {
      const ms = CONFIG.SESSION_TIMEOUT_MINUTES * 60 * 1000
      console.log('[Main] 会话将在', CONFIG.SESSION_TIMEOUT_MINUTES, '分钟后结束')
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
      stopPlayback()
      destroyPlayer()
      disconnect()
    }
  }
}
</script>

<style scoped>
.container {
  width: 100vw;
  height: 100vh;
  background: #0a0a0a;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
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

.end-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.end-text {
  font-size: 200rpx;
  color: #e94560;
  font-weight: bold;
}
</style>
