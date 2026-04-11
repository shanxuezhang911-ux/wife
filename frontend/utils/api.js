/**
 * 后端API封装
 * 所有接口统一走这里
 */

const BASE_URL = 'http://localhost:8091'

/**
 * GET /api/auto-open?time_hour=N
 * APP启动时获取攻击型开场白
 */
export function fetchAutoOpen(timeHour) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}/api/auto-open`,
      method: 'GET',
      data: { time_hour: timeHour },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data.text || res.data)
        } else {
          reject(new Error('auto-open请求失败: ' + res.statusCode))
        }
      },
      fail: (err) => reject(new Error('网络错误: ' + JSON.stringify(err)))
    })
  })
}

/**
 * POST /api/chat
 * 发送用户语音识别文本，获取AI回复
 */
export function fetchChat(userText, timeHour) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}/api/chat`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        user_text: userText,
        time_hour: timeHour
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data.ai_text || res.data)
        } else {
          reject(new Error('chat请求失败: ' + res.statusCode))
        }
      },
      fail: (err) => reject(new Error('网络错误: ' + JSON.stringify(err)))
    })
  })
}

/**
 * 获取当前小时数
 */
export function getCurrentHour() {
  return new Date().getHours()
}
