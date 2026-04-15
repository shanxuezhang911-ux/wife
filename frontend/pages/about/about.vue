<template>
  <view class="about-page">
    <!-- 顶部导航栏 - 自动适配刘海 -->
    <view class="navbar" :style="{ paddingTop: statusBarHeight + 20 + 'px' }">
      <view class="nav-back" @click="goBack">
        <text class="back-text">← 返回</text>
      </view>
      <view class="nav-title">关于软件</view>
      <view class="nav-empty"></view>
    </view>

    <!-- 主内容区 -->
    <scroll-view scroll-y class="scroll-container">
      <!-- 应用信息头部 -->
      <view class="app-info">
        <image class="app-logo" src="/static/wife_hc.png" mode="aspectFit"></image>
        <text class="app-name">蒸馏爱人</text>
        <text class="app-version">Version 1.0.0</text>
      </view>

      <!-- 功能说明卡片 -->
      <view class="card-section">
        <view class="card card-feature">
          <view class="card-header">
            <text class="card-title">核心特性</text>
          </view>
          <view class="card-body">
            <view class="feature-item">
              <text class="feature-dot">•</text>
              <text class="feature-text">纯云端计算，本地无数据存储</text>
            </view>
            <view class="feature-item">
              <text class="feature-dot">•</text>
              <text class="feature-text">支持AI模型定制训练服务</text>
            </view>
            <view class="feature-item">
              <text class="feature-dot">•</text>
              <text class="feature-text">持续迭代，新增更多对话场景</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 算力支持卡片 -->
      <view class="card-section">
        <view class="card card-sponsor">
          <view class="card-header">
            <text class="card-title">感谢算力支持</text>
            <text class="update-time">2026-04-14 更新</text>
          </view>
          <scroll-view scroll-y class="sponsor-scroll">
            <view class="sponsor-item" v-for="(name, idx) in sponsors" :key="idx">
              <text class="sponsor-name">{{ name }}</text>
            </view>
            <view class="empty-tip" v-if="!sponsors.length">
              <text>暂无数据</text>
            </view>
          </scroll-view>
        </view>
      </view>

      <!-- 联系开发者 -->
      <view class="contact-card" @click="copyQQ">
        <text class="contact-icon">💬</text>
        <text class="contact-text">联系开发者 · 点击复制QQ</text>
      </view>

      <!-- 免责声明 - 底部安全区 -->
      <view class="disclaimer">
        <text class="disclaimer-title">免责声明</text>
        <text class="disclaimer-content">
          本软件仅供娱乐使用，AI生成内容不代表任何真实立场。使用者请自行判断内容适用性，因使用产生的任何风险与后果，开发者不承担法律责任。
        </text>
        <!-- 苹果底部安全区占位 -->
        <view class="safe-bottom"></view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import CONFIG from '../../utils/config.js'
export default {
  data() {
    return {
      sponsors: [],
      statusBarHeight: 44
    }
  },
  onLoad() {
    const sysInfo = uni.getSystemInfoSync()
    this.statusBarHeight = sysInfo.statusBarHeight || 44
    this.getSponsorList()
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => {
          uni.reLaunch({ url: '/pages/index/index' })
        }
      })
    },
    getSponsorList() {
      uni.request({
        url: CONFIG.API_BASE + '/api/sponsors',
        method: 'GET',
        success: res => {
          if (res.statusCode === 200 && res.data?.data) {
            this.sponsors = res.data.data
          }
        }
      })
    },
    copyQQ() {
      uni.setClipboardData({
        data: '123456',
        success: () => {
          uni.showToast({
            title: 'QQ号复制成功',
            icon: 'success',
            duration: 1200
          })
        }
      })
    }
  }
}
</script>

<style scoped>
/* ------------------------------
  全局适配：微信小程序 + 苹果安全区
------------------------------ */
page {
  background: #ffffff;
  margin: 0;
  padding: 0;
}
.about-page {
  width: 100vw;
  min-height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

/* ------------------------------
  导航栏：自动适配苹果刘海/灵动岛
------------------------------ */
.navbar {
  padding-top: calc(var(--status-bar-height, 44rpx) + 20rpx);
  padding-left: 32rpx;
  padding-right: 32rpx;
  padding-bottom: 20rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20rpx);
  z-index: 99;
}
.nav-back {
  min-width: 120rpx;
  min-height: 72rpx;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}
.nav-back:active {
  opacity: 0.6;
  transform: translateX(-4rpx);
}
.back-text {
  font-size: 28rpx;
  color: rgba(0,0,0,0.6);
}
.nav-title {
  font-size: 32rpx;
  color: rgba(0,0,0,0.85);
  font-weight: 500;
}
.nav-empty {
  width: 80rpx;
}

/* ------------------------------
  内容滚动区
------------------------------ */
.scroll-container {
  flex: 1;
  padding: 0 32rpx;
  box-sizing: border-box;
  width: 100%;
}

/* 应用信息 */
.app-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0 48rpx;
}
.app-logo {
  width: 120rpx;
  height: 120rpx;
  border-radius: 32rpx;
  margin-bottom: 24rpx;
}
.app-name {
  font-size: 44rpx;
  color: #1a1a1a;
  font-weight: 500;
  margin-bottom: 8rpx;
}
.app-version {
  font-size: 24rpx;
  color: rgba(0,0,0,0.35);
}

/* 卡片通用样式 */
.card-section {
  margin-bottom: 24rpx;
}
.card {
  background: #f7f7f8;
  border-radius: 24rpx;
  padding: 32rpx;
  border: 1rpx solid rgba(0,0,0,0.06);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.card-title {
  font-size: 28rpx;
  color: rgba(0,0,0,0.8);
  font-weight: 500;
}
.update-time {
  font-size: 22rpx;
  color: rgba(0,0,0,0.35);
}

/* 特性列表 */
.feature-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 16rpx;
}
.feature-dot {
  color: #e94560;
  margin-right: 12rpx;
  font-size: 22rpx;
}
.feature-text {
  flex: 1;
  font-size: 26rpx;
  color: rgba(0,0,0,0.55);
  line-height: 1.5;
}

/* 赞助列表 */
.sponsor-scroll {
  max-height: 320rpx;
}
.sponsor-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid rgba(0,0,0,0.06);
}
.sponsor-name {
  font-size: 26rpx;
  color: rgba(0,0,0,0.55);
}
.empty-tip {
  text-align: center;
  padding: 40rpx 0;
}
.empty-tip text {
  color: rgba(0,0,0,0.25);
  font-size: 24rpx;
}

/* 联系开发者 */
.contact-card {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(233, 69, 96, 0.08);
  border-radius: 24rpx;
  padding: 28rpx;
  margin: 40rpx 0;
  border: 1rpx solid rgba(233,69,96,0.15);
  transition: all 0.2s ease;
}
.contact-card:active {
  background: rgba(233,69,96,0.12);
  transform: scale(0.98);
}
.contact-icon {
  margin-right: 12rpx;
  font-size: 28rpx;
}
.contact-text {
  font-size: 26rpx;
  color: #e94560;
  font-weight: 500;
}

/* ------------------------------
  免责声明 + 苹果底部安全区
------------------------------ */
.disclaimer {
  padding: 32rpx 0;
}
.disclaimer-title {
  display: block;
  text-align: center;
  font-size: 24rpx;
  color: rgba(0,0,0,0.4);
  margin-bottom: 12rpx;
}
.disclaimer-content {
  font-size: 22rpx;
  color: rgba(0,0,0,0.3);
  line-height: 1.6;
  text-align: center;
}
/* 底部安全区：适配iPhone底部横条 */
.safe-bottom {
  height: env(safe-area-inset-bottom);
}
</style>