import { describe, it, expect } from 'vitest'
import { parseTxtFile, isDialogueText } from '../textParser'

// ===== textParser 测试 =====
// TDD: 此文件先于 textParser.ts 编写，预期全部失败

describe('parseTxtFile', () => {
  it('首行非空为标题，其余为正文', () => {
    const content = 'My First Lesson\n\nThis is the body text.\nIt has multiple lines.'
    const result = parseTxtFile(content)
    expect(result.title).toBe('My First Lesson')
    expect(result.textContent).toBe('This is the body text.\nIt has multiple lines.')
  })

  it('仅一行时整行为正文，title 为 null', () => {
    const result = parseTxtFile('Just a single line of text.')
    expect(result.title).toBeNull()
    expect(result.textContent).toBe('Just a single line of text.')
  })

  it('首行为空时，title 为 null，取第一非空行开始为正文', () => {
    const content = '\n\nActual content starts here.\nMore lines.'
    const result = parseTxtFile(content)
    expect(result.title).toBeNull()
    expect(result.textContent).toBe('Actual content starts here.\nMore lines.')
  })

  it('首行+正文之间有多个空行，应正确跳过', () => {
    const content = 'Title Line\n\n\n\nBody here.'
    const result = parseTxtFile(content)
    expect(result.title).toBe('Title Line')
    expect(result.textContent).toBe('Body here.')
  })

  it('空内容应抛错', () => {
    expect(() => parseTxtFile('')).toThrow()
  })

  it('仅空白字符应抛错', () => {
    expect(() => parseTxtFile('   \n\n  \t  ')).toThrow()
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
