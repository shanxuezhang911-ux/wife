/**
 * WebSocket 代理服务器
 * 浏览器 → ws://localhost:9090 → 代理 → wss://openspeech.bytedance.com (带鉴权)
 */
const { WebSocketServer, WebSocket } = require('ws')

const PORT = 9090

// 豆包认证信息
const DOUBAO_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'
const APP_ID = '7050730175'
const ACCESS_TOKEN = 'fcfNjdty_SQTPAH4SgGGl9het8IfWK42'
const RESOURCE_ID = 'volc.speech.dialog'
const APP_KEY = 'PlgvMymc7f3tQnJ6'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const wss = new WebSocketServer({ port: PORT })

console.log('╔══════════════════════════════════╗')
console.log('║  豆包 WebSocket 代理已启动        ║')
console.log('║  监听: ws://localhost:' + PORT + '        ║')
console.log('╚══════════════════════════════════╝')

let activeClient = null

wss.on('connection', (clientWs, req) => {
  if (activeClient && activeClient.readyState === WebSocket.OPEN) {
    console.log('[代理] 关闭旧连接')
    activeClient.close()
  }
  activeClient = clientWs

  const connectId = uuid()
  console.log('[代理] 新客户端, connectId=' + connectId)

  const headers = {
    'X-Api-App-Key': APP_KEY,
    'X-Api-Access-Key': ACCESS_TOKEN,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id': connectId,
    'Authorization': 'Bearer;' + ACCESS_TOKEN,
    'X-Api-App-Id': APP_ID
  }

  console.log('[代理] 连接:', DOUBAO_URL)
  console.log('[代理] Headers:', Object.keys(headers).join(', '))

  let pendingMessages = []
  let remoteReady = false

  const remoteWs = new WebSocket(DOUBAO_URL, {
    headers,
    handshakeTimeout: 10000
  })

  remoteWs.binaryType = 'arraybuffer'

  remoteWs.on('open', () => {
    console.log('[代理] → 豆包连接成功!')
    remoteReady = true
    if (pendingMessages.length > 0) {
      console.log('[代理] 发送', pendingMessages.length, '条缓存消息')
      pendingMessages.forEach(msg => remoteWs.send(msg.data, { binary: msg.binary }))
      pendingMessages = []
    }
  })

  // 豆包 → 客户端
  remoteWs.on('message', (data, isBinary) => {
    const size = data.byteLength || data.length || 0
    console.log('[代理] ← 豆包:', size, 'bytes, binary=' + isBinary)
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary })
    }
  })

  // 客户端 → 豆包
  clientWs.on('message', (data, isBinary) => {
    const size = data.byteLength || data.length || 0
    console.log('[代理] → 豆包:', size, 'bytes, binary=' + isBinary)
    if (remoteReady && remoteWs.readyState === WebSocket.OPEN) {
      remoteWs.send(data, { binary: isBinary })
    } else {
      pendingMessages.push({ data, binary: isBinary })
      console.log('[代理] 缓存消息 (' + pendingMessages.length + '条)')
    }
  })

  remoteWs.on('unexpected-response', (req, res) => {
    console.error('[代理] 豆包拒绝! HTTP', res.statusCode, res.statusMessage)
    let body = ''
    res.on('data', chunk => { body += chunk })
    res.on('end', () => {
      console.error('[代理] 响应:', body)
      // 打印服务端返回的所有response headers，帮助调试
      console.error('[代理] 响应头:', JSON.stringify(res.headers, null, 2))
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close()
    })
  })

  remoteWs.on('error', (err) => {
    console.error('[代理] 错误:', err.message)
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close()
  })

  remoteWs.on('close', (code, reason) => {
    console.log('[代理] 豆包断开: code=' + code)
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close()
  })

  clientWs.on('close', () => {
    console.log('[代理] 客户端断开')
    if (activeClient === clientWs) activeClient = null
    if (remoteWs.readyState === WebSocket.OPEN) remoteWs.close()
  })

  clientWs.on('error', (err) => {
    console.error('[代理] 客户端错误:', err.message)
  })
})
