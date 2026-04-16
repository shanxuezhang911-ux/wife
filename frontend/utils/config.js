/**
 * 客户端配置
 * 敏感配置（密钥、人设、模型参数）已迁移到后端
 * 前端启动时从 GET /api/config/session 拉取
 */

const SERVER_DOMAIN = 'www.zsx.asia'

export default {
  // ==================== 服务器地址 ====================
  API_BASE: `https://${SERVER_DOMAIN}:9001`,
  WS_URL: `wss://${SERVER_DOMAIN}:9001/ws/doubao`,

  // ==================== 音频配置（纯本地） ====================
  AUDIO: {
    INPUT_SAMPLE_RATE: 16000,
    INPUT_CHANNELS: 1,
    INPUT_FORMAT: 'pcm',
    OUTPUT_FORMAT: 'pcm_s16le',
    OUTPUT_SAMPLE_RATE: 24000
  }
}
