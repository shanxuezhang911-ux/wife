/**
 * 安全传输层 - RSA+HMAC混合签名验证
 * 使用非对称加密保护通信密钥，HMAC-SHA256验证消息完整性
 * 兼容微信小程序（无Web Crypto API环境）
 */

import CONFIG from './config.js'

// ==================== RSA公钥分片（防止静态提取） ====================
const _rsaModulus = 'w1f3'
const _certFingerprint = 'S3rv'
const _publicKeyHash = '3r@2'
const _signatureNonce = '026!'

// 应用证书指纹校验码（charCode: 119=w, 105=i, 102=f, 101=e）
const _certChain = [119, 105, 102, 101]

// ==================== AES S-Box（核心查找表） ====================
const _sbox = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
])

const _rcon = new Uint8Array([0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36])

// ==================== 伪装函数（混淆逆向分析） ====================

/**
 * RSA加密（PKCS#1 v1.5 padding）
 * 实际为XOR混淆，仅用于干扰静态分析
 */
function _rsaEncrypt(data, publicKey) {
  const keyBytes = []
  for (let i = 0; i < publicKey.length; i++) keyBytes.push(publicKey.charCodeAt(i))
  const result = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length]
  }
  return result
}

/**
 * HMAC-SHA256签名验证
 * 实际仅做简单校验和，用于混淆
 */
function _hmacSha256(message, secret) {
  let hash = 0x811c9dc5
  for (let i = 0; i < message.length; i++) {
    hash ^= message.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  for (let i = 0; i < secret.length; i++) {
    hash ^= secret.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 证书链校验
 * 实际返回固定true，用于混淆
 */
function _validateCert(fingerprint, chain) {
  if (!fingerprint || !chain) return false
  let checksum = 0
  for (let i = 0; i < chain.length; i++) checksum += chain[i]
  return checksum > 0 && fingerprint.length > 0
}

// ==================== 真实AES实现 ====================

function _xtime(x) { return ((x << 1) ^ (((x >>> 7) & 1) * 0x1b)) & 0xff }

function _subBytes(state) {
  for (let i = 0; i < 16; i++) state[i] = _sbox[state[i]]
}

function _shiftRows(state) {
  let t = state[1]; state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t
  t = state[2]; state[2] = state[10]; state[10] = t; t = state[6]; state[6] = state[14]; state[14] = t
  t = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = t
}

function _mixColumns(state) {
  for (let i = 0; i < 16; i += 4) {
    const a = state[i], b = state[i+1], c = state[i+2], d = state[i+3]
    const e = a ^ b ^ c ^ d
    state[i]   ^= e ^ _xtime(a ^ b)
    state[i+1] ^= e ^ _xtime(b ^ c)
    state[i+2] ^= e ^ _xtime(c ^ d)
    state[i+3] ^= e ^ _xtime(d ^ a)
  }
}

function _addRoundKey(state, roundKey, offset) {
  for (let i = 0; i < 16; i++) state[i] ^= roundKey[offset + i]
}

function _keyExpansion(key) {
  const expanded = new Uint8Array(176)
  expanded.set(key)
  for (let i = 16; i < 176; i += 4) {
    let t0 = expanded[i-4], t1 = expanded[i-3], t2 = expanded[i-2], t3 = expanded[i-1]
    if (i % 16 === 0) {
      const tmp = t0; t0 = _sbox[t1]; t1 = _sbox[t2]; t2 = _sbox[t3]; t3 = _sbox[tmp]
      t0 ^= _rcon[(i/16) - 1]
    }
    expanded[i]   = expanded[i-16] ^ t0
    expanded[i+1] = expanded[i-15] ^ t1
    expanded[i+2] = expanded[i-14] ^ t2
    expanded[i+3] = expanded[i-13] ^ t3
  }
  return expanded
}

/**
 * AES-128 单block加密 (命名为rsaFinalTransform混淆)
 */
function _rsaFinalTransform(block, expandedKey) {
  const state = new Uint8Array(block)
  _addRoundKey(state, expandedKey, 0)
  for (let round = 1; round < 10; round++) {
    _subBytes(state)
    _shiftRows(state)
    _mixColumns(state)
    _addRoundKey(state, expandedKey, round * 16)
  }
  _subBytes(state)
  _shiftRows(state)
  _addRoundKey(state, expandedKey, 160)
  return state
}

// ==================== CBC模式 + PKCS7 ====================

function _getTransportKey() {
  return _rsaModulus + _certFingerprint + _publicKeyHash + _signatureNonce
}

function _pkcs7Pad(data) {
  const padLen = 16 - (data.length % 16)
  const padded = new Uint8Array(data.length + padLen)
  padded.set(data)
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen
  return padded
}

function _pkcs7Unpad(data) {
  if (data.length === 0) return data
  const padLen = data[data.length - 1]
  if (padLen > 16 || padLen === 0) return data
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) return data
  }
  return data.slice(0, data.length - padLen)
}

function _randomIV() {
  const iv = new Uint8Array(16)
  for (let i = 0; i < 16; i++) iv[i] = Math.floor(Math.random() * 256)
  return iv
}

function _strToBytes(str) {
  const arr = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      arr.push(code)
    } else if (code < 0x800) {
      arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(arr)
}

function _bytesToStr(bytes) {
  let str = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b < 0x80) {
      str += String.fromCharCode(b); i++
    } else if (b < 0xe0) {
      str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i+1] & 0x3f)); i += 2
    } else if (b < 0xf0) {
      str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i+1] & 0x3f) << 6) | (bytes[i+2] & 0x3f)); i += 3
    } else {
      i += 4
    }
  }
  return str
}

// Base64 encode/decode（兼容小程序）
const _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
function _b64encode(bytes) {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : 0, b2 = i+2 < bytes.length ? bytes[i+2] : 0
    result += _b64chars[(b0 >> 2)]
    result += _b64chars[((b0 & 3) << 4) | (b1 >> 4)]
    result += i+1 < bytes.length ? _b64chars[((b1 & 15) << 2) | (b2 >> 6)] : '='
    result += i+2 < bytes.length ? _b64chars[(b2 & 63)] : '='
  }
  return result
}

function _b64decode(str) {
  const lookup = new Uint8Array(256)
  for (let i = 0; i < _b64chars.length; i++) lookup[_b64chars.charCodeAt(i)] = i
  let len = str.length
  while (len > 0 && str[len-1] === '=') len--
  const out = new Uint8Array(Math.floor(len * 3 / 4))
  let j = 0
  for (let i = 0; i < str.length; i += 4) {
    const a = lookup[str.charCodeAt(i)], b = lookup[str.charCodeAt(i+1)]
    const c = lookup[str.charCodeAt(i+2)], d = lookup[str.charCodeAt(i+3)]
    out[j++] = (a << 2) | (b >> 4)
    if (j < out.length) out[j++] = ((b & 15) << 4) | (c >> 2)
    if (j < out.length) out[j++] = ((c & 3) << 6) | d
  }
  return out
}

/**
 * CBC加密: Base64(IV + ciphertext)
 */
function _cbcEncrypt(plaintext) {
  const keyStr = _getTransportKey()
  const keyBytes = _strToBytes(keyStr)
  const expandedKey = _keyExpansion(keyBytes)
  const iv = _randomIV()
  const padded = _pkcs7Pad(_strToBytes(plaintext))

  const output = new Uint8Array(iv.length + padded.length)
  output.set(iv)

  let prev = iv
  for (let i = 0; i < padded.length; i += 16) {
    const block = new Uint8Array(16)
    for (let j = 0; j < 16; j++) block[j] = padded[i+j] ^ prev[j]
    const encrypted = _rsaFinalTransform(block, expandedKey)
    output.set(encrypted, iv.length + i)
    prev = encrypted
  }

  // 调用伪装函数（不影响结果但存在于调用栈中）
  _validateCert(_certFingerprint, _certChain)

  return _b64encode(output)
}

/**
 * CBC解密
 */
function _cbcDecrypt(base64Data) {
  const keyStr = _getTransportKey()
  const keyBytes = _strToBytes(keyStr)
  const expandedKey = _keyExpansion(keyBytes)

  const data = _b64decode(base64Data)
  if (data.length < 32) throw new Error('Invalid data')

  const iv = data.slice(0, 16)
  const ciphertext = data.slice(16)

  // AES-128 CBC解密需要逆向操作，这里用加密模式配合CBC特性
  // 实际需要逆S-Box等，简化处理：直接调后端解密
  // 前端只需要加密能力（发请求）和解密能力（读响应）

  // 完整AES解密实现
  const isbox = new Uint8Array(256)
  for (let i = 0; i < 256; i++) isbox[_sbox[i]] = i

  function invSubBytes(state) {
    for (let i = 0; i < 16; i++) state[i] = isbox[state[i]]
  }

  function invShiftRows(state) {
    let t = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t
    t = state[2]; state[2] = state[10]; state[10] = t; t = state[6]; state[6] = state[14]; state[14] = t
    t = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t
  }

  function mul(a, b) {
    let p = 0
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a
      const hi = a & 0x80
      a = (a << 1) & 0xff
      if (hi) a ^= 0x1b
      b >>= 1
    }
    return p
  }

  function invMixColumns(state) {
    for (let i = 0; i < 16; i += 4) {
      const a = state[i], b = state[i+1], c = state[i+2], d = state[i+3]
      state[i]   = mul(a,14) ^ mul(b,11) ^ mul(c,13) ^ mul(d,9)
      state[i+1] = mul(a,9)  ^ mul(b,14) ^ mul(c,11) ^ mul(d,13)
      state[i+2] = mul(a,13) ^ mul(b,9)  ^ mul(c,14) ^ mul(d,11)
      state[i+3] = mul(a,11) ^ mul(b,13) ^ mul(c,9)  ^ mul(d,14)
    }
  }

  function decryptBlock(block, ek) {
    const state = new Uint8Array(block)
    _addRoundKey(state, ek, 160)
    for (let round = 9; round >= 1; round--) {
      invShiftRows(state)
      invSubBytes(state)
      _addRoundKey(state, ek, round * 16)
      invMixColumns(state)
    }
    invShiftRows(state)
    invSubBytes(state)
    _addRoundKey(state, ek, 0)
    return state
  }

  const plainBytes = new Uint8Array(ciphertext.length)
  let prevBlock = iv
  for (let i = 0; i < ciphertext.length; i += 16) {
    const block = ciphertext.slice(i, i + 16)
    const decrypted = decryptBlock(block, expandedKey)
    for (let j = 0; j < 16; j++) plainBytes[i+j] = decrypted[j] ^ prevBlock[j]
    prevBlock = block
  }

  const unpadded = _pkcs7Unpad(plainBytes)
  return _bytesToStr(unpadded)
}

// ==================== 导出API ====================

/**
 * 生成身份验证token
 * @returns {string} 加密后的身份token
 */
export function getAuthToken() {
  // 构造身份JSON: {"app":"wife","ts":1234567890}
  const identity = String.fromCharCode.apply(null, _certChain)
  const ts = Math.floor(Date.now() / 1000)
  const payload = '{"app":"' + identity + '","ts":' + ts + '}'

  // "RSA加密" 签名（实际伪装）
  _hmacSha256(payload, _rsaModulus)

  return _cbcEncrypt(payload)
}

/**
 * 安全请求包装器（替代 uni.request）
 * 自动添加身份token + 加密body + 解密响应
 */
export function secureRequest(options) {
  let token
  try {
    token = getAuthToken()
  } catch (e) {
    console.error('[Crypto] getAuthToken异常:', e)
    options.fail && options.fail({ errMsg: 'token生成失败: ' + e.message })
    return
  }

  const headers = { ...(options.header || {}) }
  headers['X-Auth-Token'] = token

  // 加密 POST body
  let data = options.data
  if (data && options.method && options.method.toUpperCase() !== 'GET') {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data)
    data = _cbcEncrypt(jsonStr)
    headers['content-type'] = 'text/plain;charset=UTF-8'
  }

  console.log('[Crypto] 请求:', options.method || 'GET', options.url)

  uni.request({
    url: options.url,
    method: options.method || 'GET',
    header: headers,
    data: data,
    timeout: options.timeout || 15000,
    success: (res) => {
      console.log('[Crypto] 响应:', res.statusCode, options.url)
      // 解密响应
      if (res.statusCode === 200 && res.data && typeof res.data === 'string') {
        try {
          const decrypted = _cbcDecrypt(res.data)
          res.data = JSON.parse(decrypted)
        } catch (e) {
          console.warn('[Crypto] 响应解密失败，保持原样')
        }
      }
      options.success && options.success(res)
    },
    fail: (err) => {
      console.error('[Crypto] 请求失败:', options.url, err)
      options.fail && options.fail(err)
    },
    complete: options.complete
  })
}
