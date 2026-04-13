/**
 * 开场白模块 - 根据时间生成攻击型开场台词
 * 用于 SayHello 事件
 */

const OPENING_LINES = {
  // 06-10点：起床气
  MORNING: [
    '你醒了？你倒是睡得挺好啊，我昨晚一晚上没睡好你知道吗？你打呼噜打得跟拖拉机似的，我推了你八百遍你动都不动，你是猪吗？',
    '几点了你知道吗？孩子哭了半天你听不见？你是不是装睡？每次孩子一哭你就跟死了一样，什么都是我来，我嫁给你到底图什么',
    '你可算醒了，今天你必须把阳台收拾了，上次说好的你又没做。你看看你答应过我多少事？一件都没办到过',
    '别跟我说早安，你昨天说的那些话你忘了？你以为睡一觉就没事了？没那么容易'
  ],
  // 10-14点：做饭抱怨
  NOON: [
    '我在做饭呢你看不到吗？又在刷手机？你就不能来帮我切个菜？你是没手还是没眼睛？每次做饭都是我一个人，你就知道等吃',
    '你告诉我今天中午想吃什么？别跟我说随便！上次你说随便我做了三个菜你一口没吃！你到底想怎样？',
    '油烟机坏了你说了两个月了修了吗？我天天被油烟呛，你在那吹空调看视频，你的命是命我的命就不是命了？'
  ],
  // 14-18点：洗衣委屈
  AFTERNOON: [
    '你知道我今天洗了几桶衣服吗？三桶！你的衣服、孩子的衣服、床单被套！你干了什么？你今天除了坐在那你干了什么？',
    '你的袜子能不能不要翻着脱？每次都是我一只一只翻过来洗，你妈没教过你吗？',
    '我手都泡白了你看看，你心疼吗？你肯定不心疼，你要心疼会让我一个人干这些？'
  ],
  // 18-23点：疲惫求哄
  EVENING: [
    '我今天累死了你知道吗？你关心了我一句吗？你回来就知道瘫在沙发上，我也想休息！我也是人！你什么时候能体谅我？',
    '你回来了？几点了你知道吗？你说六点到家呢？你同事朋友圈发了火锅照片，你说你在加班？你自己解释吧！',
    '你能不能别玩手机了？你回来就换鞋沙发手机，你的人生就这三件事是吧？你有没有想过跟我说说话？'
  ],
  // 23点后：深夜崩溃
  NIGHT: [
    '你睡了？你怎么就睡得着？我在这失眠你不知道吗？我满脑子都在想这几年到底在过什么日子',
    '我睡不着，我在想你以前说的那些话，你说要给我最好的，呵，骗子，你就是个骗子',
    '我问你，你还爱我吗？你别着急回答，你好好想想再说'
  ]
}

export function getOpeningLine() {
  const hour = new Date().getHours()
  let pool
  if (hour >= 6 && hour < 10) pool = OPENING_LINES.MORNING
  else if (hour >= 10 && hour < 14) pool = OPENING_LINES.NOON
  else if (hour >= 14 && hour < 18) pool = OPENING_LINES.AFTERNOON
  else if (hour >= 18 && hour < 23) pool = OPENING_LINES.EVENING
  else pool = OPENING_LINES.NIGHT
  return pool[Math.floor(Math.random() * pool.length)]
}

export function getMoodLabel() {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 10) return '起床气'
  if (hour >= 10 && hour < 14) return '做饭中'
  if (hour >= 14 && hour < 18) return '干家务'
  if (hour >= 18 && hour < 23) return '求你哄'
  return '要崩溃'
}
