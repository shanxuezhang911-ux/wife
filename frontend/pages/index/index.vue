<template>
  <view class="container" @click="handleUserTap">
    <!-- 顶部状态指示灯 -->
    <view class="status-dot-wrapper">
      <view class="status-dot" :class="stateClass"></view>
    </view>

    <!-- 中央音频可视化 -->
    <view class="visualizer-area">
      <!-- 呼吸光圈 -->
      <view class="glow-ring" :class="stateClass"></view>

      <!-- 频谱柱状图 -->
      <view class="bars-container">
        <view
          v-for="(bar, i) in bars"
          :key="i"
          class="bar"
          :class="stateClass"
          :style="{ height: bar.height + 'rpx', transitionDuration: bar.speed + 'ms' }"
        ></view>
      </view>

      <!-- 中心圆 -->
      <view class="center-circle" :class="stateClass">
        <view class="inner-pulse" :class="stateClass"></view>
      </view>
    </view>

    <!-- 底部状态波纹 -->
    <view class="bottom-area">
      <view class="ripple" :class="stateClass" v-if="state === 'LISTENING'"></view>
      <view class="ripple ripple-delay" :class="stateClass" v-if="state === 'LISTENING'"></view>
    </view>
  </view>
</template>

<script>
import { fetchAutoOpen, fetchChat, getCurrentHour } from '../../utils/api.js'
import { speak, stopSpeaking, isSpeaking } from '../../utils/speech.js'
import { startVAD, stopVAD } from '../../utils/vad.js'

const BAR_COUNT = 40

export default {
  data() {
    return {
      /**
       * 状态机:
       * IDLE       - 初始
       * SPEAKING   - AI正在朗读
       * LISTENING  - 等待用户说话（VAD监听中）
       * RECORDING  - 用户正在说话
       * PROCESSING - ASR识别 + 请求AI中
       */
      state: 'IDLE',
      bars: [],
      currentVolume: 0,
      animTimer: null
    }
  },

  computed: {
    stateClass() {
      return 'state-' + this.state.toLowerCase()
    }
  },

  onLoad() {
    this.initBars()
    this.startBarAnimation()
  },

  onReady() {
    // 请求麦克风权限后启动
    this.requestPermissionAndStart()
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
        arr.push({
          height: 8 + Math.random() * 12,
          speed: 150 + Math.random() * 100
        })
      }
      this.bars = arr
    },

    async requestPermissionAndStart() {
      // #ifdef APP-PLUS
      const granted = await this.requestAppPermission()
      if (!granted) {
        console.error('[Main] 麦克风权限被拒绝')
        // 即使没权限也尝试启动（TTS可用）
      }
      // #endif

      // 启动主流程
      setTimeout(() => {
        this.flowAutoOpen()
      }, 600)
    },

    // #ifdef APP-PLUS
    requestAppPermission() {
      return new Promise((resolve) => {
        plus.android.requestPermissions(
          ['android.permission.RECORD_AUDIO'],
          (result) => {
            resolve(result.granted && result.granted.length > 0)
          },
          (err) => {
            console.error('[Permission]', err)
            resolve(false)
          }
        )
      })
    },
    // #endif

    // ==================== 主交互流程 ====================

    /**
     * 流程1: APP打开 → 获取开场白 → 朗读 → 进入监听
     */
    async flowAutoOpen() {
      this.state = 'PROCESSING'
      try {
        const hour = getCurrentHour()
        console.log('[Flow] auto-open, hour=' + hour)
        const text = await fetchAutoOpen(hour)
        console.log('[Flow] 开场白:', text)

        // 朗读开场白
        await this.speakAndVisualize(text)
      } catch (e) {
        console.error('[Flow] auto-open失败', e)
        // 兜底朗读
        await this.speakAndVisualize('你来了？你来干嘛？良心发现了？')
      }

      // 朗读完成 → 进入监听
      this.startListening()
    },

    /**
     * 流程2: 用户说完话 → 发送chat → 朗读回复 → 循环监听
     */
    async flowChat(userText) {
      if (!userText || userText.trim() === '') {
        // 没识别到有效内容，重新监听
        this.startListening()
        return
      }

      this.state = 'PROCESSING'
      console.log('[Flow] 用户说:', userText)

      try {
        const hour = getCurrentHour()
        const aiText = await fetchChat(userText, hour)
        console.log('[Flow] AI回复:', aiText)

        // 朗读AI回复
        await this.speakAndVisualize(aiText)
      } catch (e) {
        console.error('[Flow] chat失败', e)
        await this.speakAndVisualize('你说什么？我没听清！你能不能说话大声点！')
      }

      // 朗读完成 → 重新监听
      this.startListening()
    },

    // ==================== TTS朗读 + 可视化 ====================

    async speakAndVisualize(text) {
      this.state = 'SPEAKING'

      // 启动朗读可视化动画
      this.startSpeakingAnimation(text)

      try {
        await speak(text)
      } catch (e) {
        console.error('[Speak] 朗读失败', e)
      }

      this.state = 'IDLE'
    },

    /**
     * 朗读时的可视化：根据文本内容模拟音频波形
     * 感叹号、问号位置音量大，逗号位置短暂降低
     */
    startSpeakingAnimation(text) {
      // 构建音量曲线
      const volumeCurve = this.buildVolumeCurve(text)
      let curveIndex = 0
      const stepMs = 80

      if (this.speakAnimTimer) clearInterval(this.speakAnimTimer)

      this.speakAnimTimer = setInterval(() => {
        if (this.state !== 'SPEAKING') {
          clearInterval(this.speakAnimTimer)
          this.speakAnimTimer = null
          return
        }

        const targetVolume = curveIndex < volumeCurve.length
          ? volumeCurve[curveIndex]
          : 40 + Math.random() * 30

        this.currentVolume = targetVolume
        this.updateBarsFromVolume(targetVolume, 'speak')
        curveIndex++
      }, stepMs)
    },

    /**
     * 根据文本标点和字数构建模拟音量曲线
     */
    buildVolumeCurve(text) {
      const curve = []
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '！' || ch === '!' || ch === '？' || ch === '?') {
          curve.push(85 + Math.random() * 15)
          curve.push(75 + Math.random() * 15)
        } else if (ch === '，' || ch === ',' || ch === '。' || ch === '.') {
          curve.push(15 + Math.random() * 10)
          curve.push(10 + Math.random() * 10)
        } else if (ch === '…' || ch === '~') {
          curve.push(30 + Math.random() * 15)
        } else {
          curve.push(45 + Math.random() * 35)
        }
      }
      return curve
    },

    // ==================== VAD监听 ====================

    startListening() {
      this.state = 'LISTENING'
      this.currentVolume = 0
      console.log('[VAD] 开始监听...')

      startVAD(
        // onVoiceStart: 检测到人声
        () => {
          console.log('[VAD] 检测到人声!')
          this.onUserStartSpeaking()
        },
        // onVoiceEnd: 人声结束
        () => {
          console.log('[VAD] 人声结束')
          this.onUserStopSpeaking()
        },
        // onVolume: 音量回调
        (volume) => {
          this.currentVolume = volume
          if (this.state === 'LISTENING' || this.state === 'RECORDING') {
            this.updateBarsFromVolume(volume, 'mic')
          }
        }
      )
    },

    stopListening() {
      stopVAD()
    },

    /**
     * 用户开始说话 → 如果AI在朗读则打断
     */
    onUserStartSpeaking() {
      // 如果AI正在说话，立刻打断
      if (this.state === 'SPEAKING') {
        console.log('[Flow] 打断AI朗读!')
        stopSpeaking()
        if (this.speakAnimTimer) {
          clearInterval(this.speakAnimTimer)
          this.speakAnimTimer = null
        }
      }

      this.state = 'RECORDING'
      this.stopListening()

      // 启动正式ASR识别
      this.startASR()
    },

    /**
     * 用户停止说话
     */
    onUserStopSpeaking() {
      if (this.state === 'RECORDING') {
        // ASR模块会自动处理结束
        console.log('[Flow] 等待ASR结果...')
      }
    },

    // ==================== ASR 录音识别 ====================

    async startASR() {
      this.state = 'RECORDING'
      console.log('[ASR] 开始识别...')

      try {
        const { recognizeSpeech } = await import('../../utils/speech.js')
        const text = await recognizeSpeech()
        console.log('[ASR] 识别结果:', text)

        // 识别完成 → 发送对话
        this.flowChat(text)
      } catch (e) {
        console.error('[ASR] 识别失败', e)
        // 失败后重新监听
        this.startListening()
      }
    },

    // ==================== 音频可视化 ====================

    /**
     * 持续的柱状图动画（idle状态下的呼吸效果）
     */
    startBarAnimation() {
      if (this.animTimer) clearInterval(this.animTimer)

      this.animTimer = setInterval(() => {
        if (this.state === 'IDLE' || this.state === 'PROCESSING') {
          this.updateBarsIdle()
        }
      }, 200)
    },

    /**
     * 空闲状态：微弱呼吸动画
     */
    updateBarsIdle() {
      const time = Date.now() / 1000
      for (let i = 0; i < this.bars.length; i++) {
        const wave = Math.sin(time * 1.5 + i * 0.3) * 0.5 + 0.5
        this.bars[i].height = 6 + wave * 18
        this.bars[i].speed = 300 + Math.random() * 200
      }
    },

    /**
     * 根据音量更新柱状图
     * @param {number} volume 0-100
     * @param {string} mode 'speak' | 'mic'
     */
    updateBarsFromVolume(volume, mode) {
      const centerIndex = Math.floor(this.bars.length / 2)
      const normalizedVol = volume / 100

      for (let i = 0; i < this.bars.length; i++) {
        // 中间高两边低的分布
        const distFromCenter = Math.abs(i - centerIndex) / centerIndex
        const falloff = 1 - distFromCenter * 0.6

        // 添加随机抖动
        const jitter = 0.7 + Math.random() * 0.6

        let h
        if (mode === 'speak') {
          // AI说话：更有节奏感
          const wave = Math.sin(Date.now() / 120 + i * 0.5) * 0.3 + 0.7
          h = normalizedVol * 180 * falloff * jitter * wave
        } else {
          // 麦克风：更直接反映音量
          h = normalizedVol * 200 * falloff * jitter
        }

        this.bars[i].height = Math.max(6, Math.min(220, h))
        this.bars[i].speed = mode === 'speak' ? 80 + Math.random() * 60 : 50 + Math.random() * 40
      }
    },

    // ==================== 辅助 ====================

    /**
     * 用户点击屏幕 - 用于H5首次激活音频上下文
     */
    handleUserTap() {
      // #ifdef H5
      // 某些浏览器需要用户交互才能激活AudioContext/Speech
      if (this.state === 'IDLE') {
        this.flowAutoOpen()
      }
      // #endif
    },

    cleanup() {
      stopSpeaking()
      stopVAD()
      if (this.animTimer) {
        clearInterval(this.animTimer)
        this.animTimer = null
      }
      if (this.speakAnimTimer) {
        clearInterval(this.speakAnimTimer)
        this.speakAnimTimer = null
      }
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

/* ==================== 顶部状态点 ==================== */
.status-dot-wrapper {
  position: absolute;
  top: 120rpx;
  left: 50%;
  transform: translateX(-50%);
}
.status-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  transition: all 0.5s ease;
}
.status-dot.state-idle {
  background: #555;
  box-shadow: 0 0 8rpx #555;
}
.status-dot.state-speaking {
  background: #e94560;
  box-shadow: 0 0 20rpx #e94560, 0 0 40rpx rgba(233, 69, 96, 0.4);
  animation: dotPulse 0.8s ease-in-out infinite;
}
.status-dot.state-listening {
  background: #4ecdc4;
  box-shadow: 0 0 20rpx #4ecdc4;
  animation: dotPulse 1.5s ease-in-out infinite;
}
.status-dot.state-recording {
  background: #45b7d1;
  box-shadow: 0 0 25rpx #45b7d1;
  animation: dotPulse 0.5s ease-in-out infinite;
}
.status-dot.state-processing {
  background: #f9ca24;
  box-shadow: 0 0 15rpx #f9ca24;
  animation: dotSpin 1s linear infinite;
}

@keyframes dotPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.8); opacity: 0.6; }
}
@keyframes dotSpin {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.5); }
  100% { transform: rotate(360deg) scale(1); }
}

/* ==================== 中央可视化区域 ==================== */
.visualizer-area {
  position: relative;
  width: 700rpx;
  height: 500rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 呼吸光圈 */
.glow-ring {
  position: absolute;
  width: 420rpx;
  height: 420rpx;
  border-radius: 50%;
  border: 2rpx solid transparent;
  transition: all 0.6s ease;
}
.glow-ring.state-idle {
  border-color: rgba(100, 100, 140, 0.15);
  box-shadow: 0 0 40rpx rgba(100, 100, 140, 0.05);
}
.glow-ring.state-speaking {
  border-color: rgba(233, 69, 96, 0.4);
  box-shadow: 0 0 80rpx rgba(233, 69, 96, 0.2), inset 0 0 60rpx rgba(233, 69, 96, 0.05);
  animation: glowPulse 1.2s ease-in-out infinite;
}
.glow-ring.state-listening {
  border-color: rgba(78, 205, 196, 0.3);
  box-shadow: 0 0 60rpx rgba(78, 205, 196, 0.15);
  animation: glowPulse 2s ease-in-out infinite;
}
.glow-ring.state-recording {
  border-color: rgba(69, 183, 209, 0.5);
  box-shadow: 0 0 100rpx rgba(69, 183, 209, 0.25);
  animation: glowPulse 0.6s ease-in-out infinite;
}
.glow-ring.state-processing {
  border-color: rgba(249, 202, 36, 0.3);
  box-shadow: 0 0 50rpx rgba(249, 202, 36, 0.1);
  animation: glowSpin 2s linear infinite;
}

@keyframes glowPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.06); opacity: 0.7; }
}
@keyframes glowSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* ==================== 频谱柱状图 ==================== */
.bars-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  height: 300rpx;
  z-index: 2;
}

.bar {
  width: 6rpx;
  min-height: 6rpx;
  border-radius: 3rpx;
  transition-property: height, background-color, box-shadow;
  transition-timing-function: ease-out;
}

.bar.state-idle {
  background: linear-gradient(to top, #2a2a4a, #3a3a5a);
}
.bar.state-speaking {
  background: linear-gradient(to top, #e94560, #ff6b81, #ff8e9e);
  box-shadow: 0 0 8rpx rgba(233, 69, 96, 0.5);
}
.bar.state-listening {
  background: linear-gradient(to top, #2a5a5a, #4ecdc4);
  box-shadow: 0 0 6rpx rgba(78, 205, 196, 0.3);
}
.bar.state-recording {
  background: linear-gradient(to top, #2a4a6a, #45b7d1, #7dd3e8);
  box-shadow: 0 0 10rpx rgba(69, 183, 209, 0.5);
}
.bar.state-processing {
  background: linear-gradient(to top, #4a4020, #f9ca24);
  animation: barLoading 1.2s ease-in-out infinite alternate;
}

@keyframes barLoading {
  0% { opacity: 0.3; }
  100% { opacity: 1; }
}

/* ==================== 中心圆 ==================== */
.center-circle {
  position: absolute;
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.5s ease;
  z-index: 3;
}
.center-circle.state-idle {
  background: radial-gradient(circle, #1a1a3a 0%, #0f0f25 100%);
  border: 2rpx solid rgba(100, 100, 140, 0.2);
}
.center-circle.state-speaking {
  background: radial-gradient(circle, #3a1020 0%, #1a0810 100%);
  border: 2rpx solid rgba(233, 69, 96, 0.5);
  box-shadow: 0 0 40rpx rgba(233, 69, 96, 0.3);
}
.center-circle.state-listening {
  background: radial-gradient(circle, #0f2a28 0%, #0a1a18 100%);
  border: 2rpx solid rgba(78, 205, 196, 0.4);
  box-shadow: 0 0 30rpx rgba(78, 205, 196, 0.2);
}
.center-circle.state-recording {
  background: radial-gradient(circle, #0f2030 0%, #0a1520 100%);
  border: 2rpx solid rgba(69, 183, 209, 0.6);
  box-shadow: 0 0 50rpx rgba(69, 183, 209, 0.3);
}
.center-circle.state-processing {
  background: radial-gradient(circle, #2a2510 0%, #1a1a0a 100%);
  border: 2rpx solid rgba(249, 202, 36, 0.4);
  animation: processingSpin 2s linear infinite;
}

@keyframes processingSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.inner-pulse {
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  transition: all 0.5s ease;
}
.inner-pulse.state-idle {
  background: rgba(100, 100, 140, 0.1);
}
.inner-pulse.state-speaking {
  background: rgba(233, 69, 96, 0.4);
  animation: innerPulse 0.4s ease-in-out infinite alternate;
}
.inner-pulse.state-listening {
  background: rgba(78, 205, 196, 0.25);
  animation: innerPulse 1.5s ease-in-out infinite alternate;
}
.inner-pulse.state-recording {
  background: rgba(69, 183, 209, 0.5);
  animation: innerPulse 0.3s ease-in-out infinite alternate;
}
.inner-pulse.state-processing {
  background: rgba(249, 202, 36, 0.3);
  animation: innerPulse 0.8s ease-in-out infinite alternate;
}

@keyframes innerPulse {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(1.3); opacity: 1; }
}

/* ==================== 底部波纹 ==================== */
.bottom-area {
  position: absolute;
  bottom: 200rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ripple {
  position: absolute;
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  border: 2rpx solid rgba(78, 205, 196, 0.5);
  animation: rippleExpand 2s ease-out infinite;
}
.ripple-delay {
  animation-delay: 1s;
}

@keyframes rippleExpand {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(4); opacity: 0; }
}
</style>
