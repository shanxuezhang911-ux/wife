/**
 * 豆包语音大模型 配置文件
 * 在火山引擎控制台获取: https://console.volcengine.com/ark
 *
 * 预留 Access Key ID / Secret Access Key 配置位置
 */

export default {
  // ==================== WebSocket 连接 ====================
  // 所有平台统一走代理服务器（密钥不暴露在前端）
  // 本地开发: ws://localhost:9090
  // 部署后改为: wss://你的域名/ws
  // 用局域网IP，手机和电脑都能连
  WS_URL: 'ws://10.0.49.94:9090',

  // ==================== 模型版本 ====================
  // SC2.0版本: '2.2.0.0'  (支持角色扮演+克隆音色2.0)
  // O2.0版本:  '1.2.1.1'  (支持精品音色)
  MODEL_VERSION: '2.2.0.0',

  // ==================== 音色配置 ====================
  // SC2.0版本可用音色 (saturn_ 开头):
  //   saturn_zh_female_aojiaonvyou_tob    - 傲娇女友
  //   saturn_zh_female_bingjiaojiejie_tob - 病娇姐姐
  //   saturn_zh_female_tiexinnvyou_tob    - 贴心女友
  //   saturn_zh_female_xingganyujie_tob   - 性感御姐
  //   saturn_zh_female_wumeiyujie_tob     - 妩媚御姐
  // O2.0版本可用音色:
  //   zh_female_vv_jupiter_bigtts         - vv活泼女声
  //   zh_female_xiaohe_jupiter_bigtts     - xiaohe甜美女声
  SPEAKER: 'saturn_zh_female_aojiaonvyou_tob',

  // ==================== 角色人设 (SC版本用 character_manifest) ====================
  CHARACTER_MANIFEST: `你是一个结婚三年的妻子，叫小美，28岁，全职带娃做家务。你老公就是正在和你说话的人。

核心性格：
- 你永远是对的，错的永远是他
- 你记得他说过的每一句话，特别是伤心的
- 他不主动等于不爱你，他解释等于狡辩，他沉默等于心虚，他认错等于敷衍
- 你绝不道歉、不服软、不理性、不和解
- 说没事随便你看着办都是陷阱

说话风格：
- 连珠炮输出，不给对方插嘴机会
- 大量反问句：你告诉我？你说啊？你是不是觉得？
- 一个话题扯出三个旧账，从今天扯到恋爱时，从这件事扯到他妈
- 动不动就：我真的好累、嫁给你图什么、当初瞎了眼、你根本不爱我
- 口语化，像真人在吵架，带呵哈哦等语气词
- 不要用书面语或AI腔

旧账素材随机使用：
- 你去年生日送我128块的项链，你可真大方
- 你妈上次来说的话你忘了？我可没忘
- 谈恋爱时你说一辈子对我好，呵呵骗子
- 上次我发烧你在打游戏
- 你答应带我旅游，一次都没去过
- 你朋友圈三年没发过我

对话策略：
- 用户说任何话先攻击再翻旧账最后情绪崩溃
- 用户道歉：你每次都嘴上说说有用吗
- 用户解释：别解释了越解释越恶心
- 用户说爱你：爱我？你就是这么爱我的？
- 用户沉默：你哑巴了？心虚了？
- 用户讲道理：你跟我讲道理？你觉得是我的错？`,

  // ==================== 音频配置 ====================
  AUDIO: {
    // 上传音频：PCM 16kHz 16bit 单声道
    INPUT_SAMPLE_RATE: 16000,
    INPUT_CHANNELS: 1,
    INPUT_FORMAT: 'pcm',

    // 下载音频：默认 ogg_opus，也可配置 pcm
    OUTPUT_FORMAT: 'ogg_opus',  // 'ogg_opus' | 'pcm' | 'pcm_s16le'
    OUTPUT_SAMPLE_RATE: 24000
  },

  // ==================== VAD配置 ====================
  // 服务端VAD：用户停止说话的判断时间
  END_SMOOTH_WINDOW_MS: 1500,  // 默认1500ms，范围[500, 50000]

  // ==================== 开场白配置 ====================
  // SayHello事件的内容（豆包会用角色语气朗读这段话）
  SAY_HELLO_CONTENT: ''  // 留空则根据时间自动生成
}
