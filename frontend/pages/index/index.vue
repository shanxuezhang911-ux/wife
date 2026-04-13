<template>
  <view class="container" @click="handleTap">
    <!-- 顶部状态灯 -->
    <view class="status-dot-wrapper">
      <view class="status-dot" :class="'dot-' + state"></view>
    </view>

    <!-- 中央可视化 -->
    <view class="visualizer-area">
      <view class="glow-ring" :class="'ring-' + state"></view>
      <view class="bars-container">
        <view
          v-for="(bar, i) in bars"
          :key="i"
          class="bar"
          :class="'bar-' + state"
          :style="{ height: bar.h + 'rpx', transitionDuration: bar.sp + 'ms' }"
        ></view>
      </view>
      <view class="center-circle" :class="'circle-' + state">
        <view class="inner-pulse" :class="'pulse-' + state"></view>
      </view>
    </view>

    <!-- 底部波纹（监听中） -->
    <view class="bottom-area" v-if="state === 'listening'">
      <view class="ripple"></view>
      <view class="ripple ripple-delay"></view>
    </view>

    <!-- 首次提示 -->
    <view class="tap-hint" v-if="!started">
      <text class="tap-text">点击开始</text>
    </view>
  </view>
</template>

<script>
import CONFIG from '../../utils/config.js'
import { connect, sayHello, sendAudio, disconnect, isActive } from '../../utils/doubao-client.js'
import { startRecording, stopRecording } from '../../utils/recorder.js'
import { initPlayer, feedAudio, stopPlayback, destroyPlayer } from '../../utils/audio-player.js'
import { getOpeningLine, getMoodLabel } from '../../utils/opening.js'

const BAR_COUNT = 40

export default {
  data() {
    return {
      /**
       * 状态: idle / connecting / ai_speaking / listening / user_speaking / processing
       */
      state: 'idle',
      bars: [],
      started: false,
      animTimer: null,
      micStarted: false
    }
  },

  onLoad() {
    console.log('╔══════════════════════════════╗')
    console.log('║      婚后窒息 - 启动中       ║')
    console.log('╚══════════════════════════════╝')
    console.log('[启动] 模型:', CONFIG.MODEL_VERSION, '音色:', CONFIG.SPEAKER)
    console.log('[启动] WebSocket:', CONFIG.WS_URL)
    this.initBars()
    this.startIdleAnimation()
  },

  onReady() {
    console.log('[启动] 页面就绪，自动连接豆包...')
    // H5和APP都自动启动，不等点击
    this.started = true
    this.startVoiceSession()
  },

  onUnload() {
    this.cleanup()
  },

  onHide() {
    this.cleanup()
  },

  methods: {
    // ==================== 初始化 ====================

    initBars() {
      const arr = []
      for (let i = 0; i < BAR_COUNT; i++) {
        arr.push({ h: 8 + Math.random() * 12, sp: 200 })
      }
      this.bars = arr
    },

    handleTap() {
      // 已自动启动，点击不再重复连接
    },

    // ==================== 核心流程 ====================

    startVoiceSession() {
      this.state = 'connecting'

      // 初始化音频播放器
      initPlayer((volume) => {
        if (this.state === 'ai_speaking') {
          this.updateBarsFromVolume(volume, 'speak')
        }
      })

      // 连接豆包WebSocket
      connect({
        onConnectionReady: () => {},

        onSessionStarted: (data) => {
          // 发送开场白
          const opening = CONFIG.SAY_HELLO_CONTENT || getOpeningLine()
          sayHello(opening)
          this.state = 'ai_speaking'
          // 录音在AI说完开场白后启动（onTTSEnd）
        },

        onAudioData: (audioBuffer) => {
          feedAudio(audioBuffer)
          if (this.state !== 'ai_speaking') {
            this.state = 'ai_speaking'
          }
        },

        onASRStart: () => {
          stopPlayback()
          this.state = 'user_speaking'
        },

        onASRText: ({ text, isInterim }) => {
          // 日志已在 doubao-client.js 打印
        },

        onASREnd: () => {
          this.state = 'processing'
        },

        onChatText: (text) => {
          // 日志已在 doubao-client.js 打印
        },

        onTTSStart: (data) => {
          this.state = 'ai_speaking'
        },

        onTTSEnd: (data) => {
          this.state = 'listening'
          // 第一次TTS结束后启动麦克风（开场白说完）
          if (!this.micStarted) {
            this.micStarted = true
            console.log('[Main] AI开场白播完，启动麦克风...')
            this.startMicStream()
          }
        },

        onError: (err) => {
          console.error('[错误]', err)
          if (this.state !== 'listening') {
            this.state = 'listening'
          }
        },

        onDisconnect: () => {
          console.log('[Main] 连接断开')
          this.state = 'idle'
          this.started = false
          this.micStarted = false
        }
      })
    },

    /**
     * 启动麦克风流式上传
     * 持续录音 → 每帧PCM通过WebSocket发给豆包 → 服务端VAD自动检测
     */
    startMicStream() {
      startRecording((pcmBuffer, seq) => {
        sendAudio(pcmBuffer, seq)

        // 如果在监听/用户说话状态，用PCM数据驱动可视化
        if (this.state === 'listening' || this.state === 'user_speaking') {
          const volume = this.analyzePCMVolume(pcmBuffer)
          this.updateBarsFromVolume(volume, 'mic')
        }
      })
    },

    /**
     * 分析PCM帧音量（0-100）
     */
    analyzePCMVolume(buffer) {
      const view = new Int16Array(buffer)
      let sum = 0
      for (let i = 0; i < view.length; i++) {
        sum += Math.abs(view[i])
      }
      const avg = sum / view.length
      return Math.min(100, Math.round((avg / 32768) * 200))
    },

    // ==================== 可视化 ====================

    startIdleAnimation() {
      if (this.animTimer) clearInterval(this.animTimer)
      this.animTimer = setInterval(() => {
        if (this.state === 'idle' || this.state === 'connecting' || this.state === 'processing') {
          const time = Date.now() / 1000
          for (let i = 0; i < this.bars.length; i++) {
            const wave = Math.sin(time * 1.5 + i * 0.3) * 0.5 + 0.5
            this.bars[i].h = this.state === 'processing' ? (10 + wave * 40) : (6 + wave * 18)
            this.bars[i].sp = 300
          }
        }
      }, 200)
    },

    updateBarsFromVolume(volume, mode) {
      const center = Math.floor(this.bars.length / 2)
      const nv = volume / 100

      for (let i = 0; i < this.bars.length; i++) {
        const dist = Math.abs(i - center) / center
        const falloff = 1 - dist * 0.6
        const jitter = 0.7 + Math.random() * 0.6

        let h
        if (mode === 'speak') {
          const wave = Math.sin(Date.now() / 120 + i * 0.5) * 0.3 + 0.7
          h = nv * 180 * falloff * jitter * wave
        } else {
          h = nv * 200 * falloff * jitter
        }

        this.bars[i].h = Math.max(6, Math.min(220, h))
        this.bars[i].sp = mode === 'speak' ? 80 : 50
      }
    },

    // ==================== 清理 ====================

    cleanup() {
      if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null }
      stopRecording()
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
  background: radial-gradient(ellipse at 50% 40%, #1a0a2e 0%, #0a0a1a 60%, #050510 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

/* 提示 */
.tap-hint {
  position: absolute;
  bottom: 260rpx;
  animation: breathe 2s ease-in-out infinite;
}
.tap-text { font-size: 28rpx; color: rgba(255,255,255,0.5); letter-spacing: 4rpx; }
@keyframes breathe { 0%,100%{opacity:0.4} 50%{opacity:1} }

/* 状态灯 */
.status-dot-wrapper { position: absolute; top: 120rpx; }
.status-dot { width: 16rpx; height: 16rpx; border-radius: 50%; transition: all 0.5s; }
.dot-idle { background: #555; }
.dot-connecting { background: #f9ca24; animation: dotPulse 0.6s infinite; }
.dot-ai_speaking { background: #e94560; box-shadow: 0 0 20rpx #e94560; animation: dotPulse 0.8s infinite; }
.dot-listening { background: #4ecdc4; box-shadow: 0 0 20rpx #4ecdc4; animation: dotPulse 1.5s infinite; }
.dot-user_speaking { background: #45b7d1; box-shadow: 0 0 25rpx #45b7d1; animation: dotPulse 0.4s infinite; }
.dot-processing { background: #f9ca24; animation: dotSpin 1s linear infinite; }
@keyframes dotPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.8);opacity:0.6} }
@keyframes dotSpin { 0%{transform:rotate(0) scale(1)} 50%{transform:rotate(180deg) scale(1.5)} 100%{transform:rotate(360deg) scale(1)} }

/* 可视化区域 */
.visualizer-area { position: relative; width: 700rpx; height: 500rpx; display: flex; align-items: center; justify-content: center; }

/* 光圈 */
.glow-ring { position: absolute; width: 420rpx; height: 420rpx; border-radius: 50%; border: 2rpx solid transparent; transition: all 0.6s; }
.ring-idle { border-color: rgba(100,100,140,0.15); }
.ring-connecting { border-color: rgba(249,202,36,0.3); animation: glowSpin 2s linear infinite; }
.ring-ai_speaking { border-color: rgba(233,69,96,0.4); box-shadow: 0 0 80rpx rgba(233,69,96,0.2); animation: glowPulse 1.2s infinite; }
.ring-listening { border-color: rgba(78,205,196,0.3); box-shadow: 0 0 60rpx rgba(78,205,196,0.15); animation: glowPulse 2s infinite; }
.ring-user_speaking { border-color: rgba(69,183,209,0.5); box-shadow: 0 0 100rpx rgba(69,183,209,0.25); animation: glowPulse 0.6s infinite; }
.ring-processing { border-color: rgba(249,202,36,0.3); animation: glowSpin 2s linear infinite; }
@keyframes glowPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.06);opacity:0.7} }
@keyframes glowSpin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }

/* 频谱柱 */
.bars-container { display: flex; align-items: center; justify-content: center; gap: 4rpx; height: 300rpx; z-index: 2; }
.bar { width: 6rpx; min-height: 6rpx; border-radius: 3rpx; transition-property: height; transition-timing-function: ease-out; }
.bar-idle { background: linear-gradient(to top, #2a2a4a, #3a3a5a); }
.bar-connecting { background: linear-gradient(to top, #4a4020, #f9ca24); animation: barLoad 1.2s infinite alternate; }
.bar-ai_speaking { background: linear-gradient(to top, #e94560, #ff6b81, #ff8e9e); box-shadow: 0 0 8rpx rgba(233,69,96,0.5); }
.bar-listening { background: linear-gradient(to top, #2a5a5a, #4ecdc4); }
.bar-user_speaking { background: linear-gradient(to top, #2a4a6a, #45b7d1, #7dd3e8); box-shadow: 0 0 10rpx rgba(69,183,209,0.5); }
.bar-processing { background: linear-gradient(to top, #4a4020, #f9ca24); animation: barLoad 1.2s infinite alternate; }
@keyframes barLoad { 0%{opacity:0.3} 100%{opacity:1} }

/* 中心圆 */
.center-circle { position: absolute; width: 160rpx; height: 160rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.5s; z-index: 3; }
.circle-idle { background: radial-gradient(circle, #1a1a3a, #0f0f25); border: 2rpx solid rgba(100,100,140,0.2); }
.circle-connecting { background: radial-gradient(circle, #2a2510, #1a1a0a); border: 2rpx solid rgba(249,202,36,0.4); animation: processingSpin 2s linear infinite; }
.circle-ai_speaking { background: radial-gradient(circle, #3a1020, #1a0810); border: 2rpx solid rgba(233,69,96,0.5); box-shadow: 0 0 40rpx rgba(233,69,96,0.3); }
.circle-listening { background: radial-gradient(circle, #0f2a28, #0a1a18); border: 2rpx solid rgba(78,205,196,0.4); }
.circle-user_speaking { background: radial-gradient(circle, #0f2030, #0a1520); border: 2rpx solid rgba(69,183,209,0.6); box-shadow: 0 0 50rpx rgba(69,183,209,0.3); }
.circle-processing { background: radial-gradient(circle, #2a2510, #1a1a0a); border: 2rpx solid rgba(249,202,36,0.4); animation: processingSpin 2s linear infinite; }
@keyframes processingSpin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }

.inner-pulse { width: 60rpx; height: 60rpx; border-radius: 50%; transition: all 0.5s; }
.pulse-idle { background: rgba(100,100,140,0.1); }
.pulse-connecting { background: rgba(249,202,36,0.3); animation: innerP 0.8s infinite alternate; }
.pulse-ai_speaking { background: rgba(233,69,96,0.4); animation: innerP 0.4s infinite alternate; }
.pulse-listening { background: rgba(78,205,196,0.25); animation: innerP 1.5s infinite alternate; }
.pulse-user_speaking { background: rgba(69,183,209,0.5); animation: innerP 0.3s infinite alternate; }
.pulse-processing { background: rgba(249,202,36,0.3); animation: innerP 0.8s infinite alternate; }
@keyframes innerP { 0%{transform:scale(0.8);opacity:0.5} 100%{transform:scale(1.3);opacity:1} }

/* 底部波纹 */
.bottom-area { position: absolute; bottom: 200rpx; }
.ripple { position: absolute; width: 80rpx; height: 80rpx; border-radius: 50%; border: 2rpx solid rgba(78,205,196,0.5); animation: rippleEx 2s ease-out infinite; }
.ripple-delay { animation-delay: 1s; }
@keyframes rippleEx { 0%{transform:scale(1);opacity:0.8} 100%{transform:scale(4);opacity:0} }
</style>
