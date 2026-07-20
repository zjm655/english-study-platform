/** 单词复习 - 词汇项 */
export interface ReviewVocabItem {
  /** 词汇ID */
  id: number
  /** 所属片段ID */
  segmentId: number
  /** 英文单词 */
  word: string
  /** 音标 */
  phonetic: string | null
  /** 中文释义 */
  meaning: string
  /** 词形变化 */
  forms: string | null
  /** 英文例句 */
  exampleSentence: string | null
  /** 例句中文翻译 */
  exampleTranslation: string | null
  /** 单词发音音频签名 URL */
  audioUrl: string | null
}

/** 材料复习 - 材料项 */
export interface ReviewMaterialItem {
  /** 片段ID */
  id: number
  /** 片段标题 */
  title: string
  /** 材料音频签名 URL */
  audioUrl: string | null
  /** 理解题（JSON 字符串或已解析数组，前端自行解析） */
  questions: string | null
  /** 时长（秒） */
  duration: number | null
}
