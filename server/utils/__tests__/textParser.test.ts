import { describe, it, expect } from 'vitest'
import { parseTxtFile, extractInlineTitle, resolveUploadTitle, isDialogueText } from '../textParser'

// ===== textParser 测试 =====
// TDD: 先于 textParser.ts 编写，预期失败

describe('parseTxtFile', () => {
  it('返回清理后的正文（不再剥离首行标题，标题由 titleMode 决定）', () => {
    const content = 'My First Lesson\n\nThis is the body text.\nIt has multiple lines.'
    const result = parseTxtFile(content)
    expect(result.textContent).toBe(content.trim())
  })

  it('首行以 # 开头时仍作为正文保留（标题提取走 extractInlineTitle）', () => {
    const content = '# My Title\n\nBody here.'
    const result = parseTxtFile(content)
    expect(result.textContent).toBe(content.trim())
  })

  it('空内容应抛错', () => {
    expect(() => parseTxtFile('')).toThrow()
  })

  it('仅空白字符应抛错', () => {
    expect(() => parseTxtFile('   \n\n  \t  ')).toThrow()
  })
})

describe('extractInlineTitle', () => {
  it('首行 # 开头提取为标题并从正文移除', () => {
    const text = '# A Day at the Park\n\nThe sun was shining.\nBirds were singing.'
    const result = extractInlineTitle(text)
    expect(result.title).toBe('A Day at the Park')
    expect(result.textContent).toBe('The sun was shining.\nBirds were singing.')
  })

  it('无 # 首行时 title 为 null 且正文原样返回', () => {
    const text = 'The sun was shining.\nBirds were singing.'
    const result = extractInlineTitle(text)
    expect(result.title).toBeNull()
    expect(result.textContent).toBe(text)
  })

  it('前导空行后 # 首行仍可提取', () => {
    const text = '\n\n# My Title\n\nBody line.'
    const result = extractInlineTitle(text)
    expect(result.title).toBe('My Title')
    expect(result.textContent).toBe('Body line.')
  })

  it('# 后无空格不视为标题', () => {
    const text = '#NoSpaceTitle\n\nBody line.'
    const result = extractInlineTitle(text)
    expect(result.title).toBeNull()
    expect(result.textContent).toBe(text)
  })

  it('空文本返回 title=null', () => {
    const result = extractInlineTitle('')
    expect(result.title).toBeNull()
    expect(result.textContent).toBe('')
  })
})

describe('resolveUploadTitle', () => {
  const textContent = 'The sun was shining.\nBirds were singing.'

  it('ai 模式返回 title=null、正文不变（交流水线 AI 生成）', () => {
    const result = resolveUploadTitle({ titleMode: 'ai', textContent })
    expect(result.title).toBeNull()
    expect(result.textContent).toBe(textContent)
  })

  it('manual 模式直接使用用户填写标题', () => {
    const result = resolveUploadTitle({
      titleMode: 'manual',
      title: '  My Title  ',
      textContent,
    })
    expect(result.title).toBe('My Title')
    expect(result.textContent).toBe(textContent)
  })

  it('manual 模式未填标题返回 null', () => {
    const result = resolveUploadTitle({ titleMode: 'manual', title: '', textContent })
    expect(result.title).toBeNull()
  })

  it('text_filename 模式用文件名（去扩展名）作标题', () => {
    const result = resolveUploadTitle({
      titleMode: 'text_filename',
      fileName: 'A Day at the Park.txt',
      textContent,
    })
    expect(result.title).toBe('A Day at the Park')
    expect(result.notice).toBeUndefined()
  })

  it('text_filename 超 50 字符截取并返回 notice', () => {
    const longName = 'x'.repeat(60) + '.txt'
    const result = resolveUploadTitle({
      titleMode: 'text_filename',
      fileName: longName,
      textContent,
    })
    expect(result.title).toBe('x'.repeat(50))
    expect(result.notice).toContain('截取')
  })

  it('audio_filename 模式用文件名（去扩展名）作标题', () => {
    const result = resolveUploadTitle({
      titleMode: 'audio_filename',
      fileName: 'A Day at the Park.mp3',
      textContent,
    })
    expect(result.title).toBe('A Day at the Park')
    expect(result.notice).toBeUndefined()
  })

  it('audio_filename 超 50 字符截取并返回 notice', () => {
    const longName = 'x'.repeat(60) + '.mp3'
    const result = resolveUploadTitle({
      titleMode: 'audio_filename',
      fileName: longName,
      textContent,
    })
    expect(result.title).toBe('x'.repeat(50))
    expect(result.notice).toContain('截取')
  })

  it('inline 模式提取 # 首行为标题并清理正文', () => {
    const result = resolveUploadTitle({
      titleMode: 'inline',
      textContent: '# My Title\n\nBody line.',
    })
    expect(result.title).toBe('My Title')
    expect(result.textContent).toBe('Body line.')
  })
})

describe('isDialogueText', () => {
  it('标准对话格式（A:/B:）应判定为对话', () => {
    const text = `Alice: Hello, how are you?
Bob: I'm fine, thanks.
Alice: That's great to hear.
Bob: Yes, it is.`
    expect(isDialogueText(text)).toBe(true)
  })

  it('Speaker N 格式应判定为对话', () => {
    const text = `Speaker 1: Welcome to the show.
Speaker 2: Thank you for having me.
Speaker 1: Let's start with your story.
Speaker 2: It all began three years ago.`
    expect(isDialogueText(text)).toBe(true)
  })

  it('正常散文文章不应判定为对话', () => {
    const text = `The sun rose over the mountains, casting long shadows across the valley. Birds sang in the trees, and a gentle breeze carried the scent of wildflowers through the air. It was a perfect morning for a hike.

She packed her backpack with supplies and set off along the trail. The path wound through dense forest, opening occasionally to reveal stunning views of the peaks beyond.`
    expect(isDialogueText(text)).toBe(false)
  })

  it('新闻报道不应判定为对话', () => {
    const text = `Scientists have discovered a new species of butterfly in the Amazon rainforest. The discovery was made during a routine survey of the region's biodiversity.

The researchers published their findings in the journal Nature. They believe the species may be endemic to a small area of the forest.`
    expect(isDialogueText(text)).toBe(false)
  })

  it('混合内容（少量对话台词嵌入文章中）不应误判', () => {
    const text = `The novel begins with a mysterious letter. As the protagonist reads it, she notices the handwriting is familiar. "I can't believe this," she whispers to herself. The letter contains details about a secret that was buried decades ago.

She decides to investigate further. The trail leads her to an old mansion on the outskirts of town. There, she discovers a hidden room filled with documents and photographs that reveal the truth about her family's past.`
    // 仅 1/10 行匹配对话模式，低于 30% 阈值
    expect(isDialogueText(text)).toBe(false)
  })

  it('空文本不应判定为对话', () => {
    expect(isDialogueText('')).toBe(false)
  })

  it('仅空白行不应判定为对话', () => {
    expect(isDialogueText('   \n  \n  \t  ')).toBe(false)
  })
})
