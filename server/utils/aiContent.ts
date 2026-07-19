/**
 * AI 教学内容生成工具
 *
 * 调用 DeepSeek API（OpenAI 兼容格式），根据英文原文生成：
 * 1. 中文翻译
 * 2. 重点词汇（含音标、词形变化、释义、例句）
 * 3. 理解题（含选项和答案）
 *
 * 纯工具函数，零耦合，仅依赖 Nuxt runtimeConfig 中的 DeepSeek 配置。
 * 音标由 LLM 生成（Edge TTS 只输出音频，无法生成音标文本）。
 */

import { fileLog, fileLogError } from './fileLogger'

// ==================== 导出类型 ====================

export interface GeneratedVocabulary {
  /** 英文原词 */
  word: string
  /** 词形变化（逗号分隔），无则 null */
  forms: string | null
  /** IPA 音标，如 /ˈʃædoʊ/ */
  phonetic: string | null
  /** 中文释义 */
  meaning: string
  /** 英文例句 */
  exampleSentence: string | null
  /** 例句中文翻译 */
  exampleTranslation: string | null
}

export interface GeneratedQuestion {
  /** 题干 */
  question: string
  /** 选项数组（含 A/B/C/D 前缀） */
  options: string[]
  /** 正确答案（完整选项文本） */
  answer: string
}

/** 标题生成结果 */
export interface GenerateTitleResult {
  /** 是否生成成功 */
  success: boolean
  /** 成功时的中文标题 */
  title?: string
  /** 失败时的错误原因 */
  error?: string
}

export interface AiContentResult {
  /** 是否生成成功 */
  success: boolean
  /** 中文翻译 */
  translation?: string
  /** 重点词汇列表 */
  vocabulary?: GeneratedVocabulary[]
  /** 理解题列表 */
  questions?: GeneratedQuestion[]
  /** 失败时的错误原因 */
  error?: string
}

// ==================== 内部常量与类型 ====================

/** DeepSeek 配置结构（对应 runtimeConfig.deepseek） */
interface DeepSeekConfig {
  apiKey: string
  model: string
  baseUrl: string
}

/** 输入文本最大长度 */
const MAX_TEXT_LENGTH = 5000

/** API 超时（毫秒） */
const API_TIMEOUT = 30_000

/** 最大输出 token 数 */
const MAX_TOKENS = 3000

/** 词汇数量范围 */
const MIN_VOCAB = 1
const MAX_VOCAB = 10

/** 题目数量范围 */
const MIN_QUESTIONS = 1
const MAX_QUESTIONS = 5

const SYSTEM_PROMPT = `你是一个专业的英语教学内容生成助手。我会给你一段英文原文，你需要：

1. 提供准确的中文翻译
2. 选出 3-5 个重点词汇，为每个词提供：
   - word: 原词
   - forms: 词形变化（逗号分隔，无则留空字符串）
   - phonetic: 音标（IPA格式，如 /ˈʃædoʊ/）
   - meaning: 中文释义（简洁准确）
   - exampleSentence: 英文例句（与原文不同的新例句）
   - exampleTranslation: 例句中文翻译
3. 生成 2 道理解题，每题 4 个选项，考察对原文的理解

请以 JSON 格式返回，格式如下：
{
  "translation": "中文翻译",
  "vocabulary": [
    {
      "word": "shadow",
      "forms": "shadows,shadowed,shadowing",
      "phonetic": "/ˈʃædoʊ/",
      "meaning": "n. 影子 v. 跟踪",
      "exampleSentence": "The shadow of the tree fell across the lawn.",
      "exampleTranslation": "树的影子落在草坪上。"
    }
  ],
  "questions": [
    {
      "question": "What is the main idea of the passage?",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B. ..."
    }
  ]
}

要求：
- 翻译要自然流畅，符合中文表达习惯
- 词汇应选择原文中较有学习价值的词，按出现顺序排列
- 音标使用 IPA 国际音标格式
- 例句要简洁、地道，能体现该词的用法
- 题目选项前缀 A/B/C/D，answer 字段需包含完整选项文本
- 只返回 JSON，不要返回任何其他内容`

// ==================== 内部工具函数 ====================

/** DeepSeek API 返回的 JSON 结构 */
interface LlmResponse {
  translation?: unknown
  vocabulary?: unknown
  questions?: unknown
}

/**
 * 校验并转换 LLM 返回的词汇数据
 */
function validateVocabulary(raw: unknown): GeneratedVocabulary[] | null {
  if (!Array.isArray(raw)) return null

  const result: GeneratedVocabulary[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const word = typeof obj.word === 'string' ? obj.word.trim() : ''
    if (!word) continue

    const meaning = typeof obj.meaning === 'string' ? obj.meaning.trim() : ''
    if (!meaning) continue

    const forms = typeof obj.forms === 'string' && obj.forms.trim()
      ? obj.forms.trim()
      : null

    const phonetic = typeof obj.phonetic === 'string' && obj.phonetic.trim()
      ? obj.phonetic.trim()
      : null

    const exampleSentence = typeof obj.exampleSentence === 'string' && obj.exampleSentence.trim()
      ? obj.exampleSentence.trim()
      : null

    const exampleTranslation = typeof obj.exampleTranslation === 'string' && obj.exampleTranslation.trim()
      ? obj.exampleTranslation.trim()
      : null

    result.push({
      word,
      forms,
      phonetic,
      meaning,
      exampleSentence,
      exampleTranslation,
    })
  }

  if (result.length < MIN_VOCAB || result.length > MAX_VOCAB) return null
  return result
}

/**
 * 校验并转换 LLM 返回的题目数据
 */
function validateQuestions(raw: unknown): GeneratedQuestion[] | null {
  if (!Array.isArray(raw)) return null

  const result: GeneratedQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const question = typeof obj.question === 'string' ? obj.question.trim() : ''
    if (!question) continue

    const options = Array.isArray(obj.options)
      ? obj.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : []

    if (options.length < 2) continue

    const answer = typeof obj.answer === 'string' ? obj.answer.trim() : ''
    if (!answer) continue

    result.push({ question, options, answer })
  }

  if (result.length < MIN_QUESTIONS || result.length > MAX_QUESTIONS) return null
  return result
}

// ==================== 核心导出函数 ====================

/**
 * 根据英文原文生成教学内容
 * @param text 英文原文
 * @returns 翻译 + 词汇 + 题目，失败时返回 error
 */
export async function generateLearningContent(text: string): Promise<AiContentResult> {
  // 1. 校验输入
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '文本不能为空' }
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return { success: false, error: `文本长度超过限制（最大 ${MAX_TEXT_LENGTH} 字符）` }
  }

  // 2. 读取配置
  const config = useRuntimeConfig()
  const ds = config.deepseek as unknown as DeepSeekConfig

  if (!ds?.apiKey || !ds?.baseUrl || !ds?.model) {
    logger.error('[aiContent] DeepSeek 配置不完整')
    return { success: false, error: 'AI 服务配置缺失' }
  }

  // 3. 调用 DeepSeek API
  const url = `${ds.baseUrl.replace(/\/+$/, '')}/chat/completions`

  try {
    const resp = await serverFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ds.apiKey}`,
      },
      body: JSON.stringify({
        model: ds.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: trimmed },
        ],
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
      }),
      timeout: API_TIMEOUT,
      tag: '[aiContent]',
    })

    if (!resp.ok) {
      const body = await resp.text()
      logger.error(`[aiContent] API 返回 ${resp.status}: ${body}`)
      return { success: false, error: 'AI 服务暂时不可用' }
    }

    const data = await resp.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''

    if (!content) {
      logger.error('[aiContent] API 返回空内容')
      return { success: false, error: 'AI 未返回有效内容' }
    }

    // 4. 解析 JSON 响应
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    let parsed: LlmResponse
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      logger.error('[aiContent] JSON 解析失败:', cleaned.substring(0, 200))
      return { success: false, error: 'AI 生成内容解析失败' }
    }

    // 5. 校验输出
    const translation = typeof parsed.translation === 'string' ? parsed.translation.trim() : ''
    if (!translation) {
      logger.error('[aiContent] 翻译字段缺失或为空')
      return { success: false, error: 'AI 生成内容不完整（缺少翻译）' }
    }

    const vocabulary = validateVocabulary(parsed.vocabulary)
    if (!vocabulary) {
      logger.error('[aiContent] 词汇校验失败')
      return { success: false, error: 'AI 生成内容不完整（词汇格式错误）' }
    }

    const questions = validateQuestions(parsed.questions)
    if (!questions) {
      logger.error('[aiContent] 题目校验失败')
      return { success: false, error: 'AI 生成内容不完整（题目格式错误）' }
    }

    logger.info(`[aiContent] 学习内容生成成功 (词汇${vocabulary.length}/题目${questions.length})`)
    fileLog('ai', 'info', '[aiContent] 学习内容生成成功', {
      textLength: trimmed.length,
      vocabCount: vocabulary.length,
      questionCount: questions.length,
    })
    return {
      success: true,
      translation,
      vocabulary,
      questions,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)

    if (errMsg.includes('abort') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
      logger.error('[aiContent] 生成超时')
      fileLogError('ai', '[aiContent] 学习内容生成超时', errMsg)
      return { success: false, error: 'AI 生成超时' }
    }

    logger.error('[aiContent] 生成失败:', errMsg)
    fileLogError('ai', '[aiContent] 学习内容生成失败', errMsg)
    return { success: false, error: `AI 内容生成失败: ${errMsg}` }
  }
}

// ==================== 标题生成 ====================

/** 标题生成系统提示词 */
const TITLE_SYSTEM_PROMPT = `你是一位英语教育内容编辑。请根据以下英文学习材料，生成一个简洁、准确、吸引人的中文标题（不超过 20 个字）。标题应概括材料主题，适合学习者快速识别内容。只返回标题文本，不要返回任何其他内容。`

/** 标题生成超时（毫秒） */
const TITLE_API_TIMEOUT = 10_000

/** 标题生成最大 token 数 */
const TITLE_MAX_TOKENS = 100

/**
 * 根据英文原文生成中文标题
 * @param text 英文原文
 * @returns 标题生成结果，失败时返回 error
 */
export async function generateTitle(text: string): Promise<GenerateTitleResult> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '文本不能为空' }
  }

  const config = useRuntimeConfig()
  const ds = config.deepseek as unknown as DeepSeekConfig

  if (!ds?.apiKey || !ds?.baseUrl || !ds?.model) {
    logger.error('[aiContent] DeepSeek 配置不完整')
    return { success: false, error: 'AI 服务配置缺失' }
  }

  const url = `${ds.baseUrl.replace(/\/+$/, '')}/chat/completions`

  try {
    const resp = await serverFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ds.apiKey}`,
      },
      body: JSON.stringify({
        model: ds.model,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: trimmed.substring(0, 500) },
        ],
        temperature: 0.3,
        max_tokens: TITLE_MAX_TOKENS,
      }),
      timeout: TITLE_API_TIMEOUT,
      tag: '[aiContent]',
    })

    if (!resp.ok) {
      const body = await resp.text()
      logger.error(`[aiContent] 标题生成 API 返回 ${resp.status}: ${body}`)
      return { success: false, error: 'AI 服务暂时不可用' }
    }

    const data = await resp.json()
    let title: string = data?.choices?.[0]?.message?.content ?? ''

    if (!title) {
      logger.error('[aiContent] 标题生成返回空内容')
      return { success: false, error: 'AI 未返回有效内容' }
    }

    // 清洗：去除引号、换行、前后空格
    title = title.replace(/^["']|["']$/g, '').replace(/\n/g, ' ').trim()
    if (!title) {
      return { success: false, error: 'AI 返回标题为空' }
    }

    logger.info(`[aiContent] 标题生成成功: ${title}`)
    fileLog('ai', 'info', '[aiContent] 标题生成成功', { title })
    return { success: true, title }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('abort') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
      logger.error('[aiContent] 标题生成超时')
      fileLogError('ai', '[aiContent] 标题生成超时', errMsg)
      return { success: false, error: 'AI 生成超时' }
    }
    logger.error('[aiContent] 标题生成失败:', errMsg)
    fileLogError('ai', '[aiContent] 标题生成失败', errMsg)
    return { success: false, error: `标题生成失败: ${errMsg}` }
  }
}