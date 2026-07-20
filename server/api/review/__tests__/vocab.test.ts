import { describe, it, expect, vi } from 'vitest'
import type { VocabularyRow } from '#server/types/db'
import type { ReviewVocabItem } from '#shared/types/review'

// 在所有 import 之前设置 Nuxt 自动注入的全局函数
vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

// mock 运行时依赖，避免触发 useRuntimeConfig
vi.mock('#server/utils/db', () => ({ query: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), WORD_EXPIRE: 2100 }))
vi.mock('#server/utils/validate', () => ({
  validateError: vi.fn(),
  validateSuccess: vi.fn(),
}))

import { rowsToReviewVocab } from '../vocab.get'

type VocabMediaRow = VocabularyRow & { vocab_media_key: string | null }

function makeRow(
  overrides: Partial<VocabMediaRow> = {}
): VocabMediaRow {
  return {
    id: 1,
    segment_id: 10,
    word: 'shadow',
    forms: 'shadows,shadowed,shadowing',
    phonetic: '/ˈʃædoʊ/',
    meaning: '影子',
    exampleSentence: 'The shadow is long.',
    exampleTranslation: '影子很长。',
    media_id: null,
    sort_order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    vocab_media_key: 'vocab/audio/shadow.mp3',
    ...overrides,
  }
}

describe('rowsToReviewVocab', () => {
  it('正常行 → 正确映射字段（snake_case → camelCase）', () => {
    const rows = [makeRow()]
    const result = rowsToReviewVocab(rows, ['https://signed.url/shadow.mp3'])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 1,
      segmentId: 10,
      word: 'shadow',
      phonetic: '/ˈʃædoʊ/',
      meaning: '影子',
      forms: 'shadows,shadowed,shadowing',
      exampleSentence: 'The shadow is long.',
      exampleTranslation: '影子很长。',
      audioUrl: 'https://signed.url/shadow.mp3',
    })
  })

  it('audioUrl 使用传入的签名 URL（按索引对应）', () => {
    const rows = [
      makeRow({ id: 1, word: 'shadow' }),
      makeRow({ id: 2, word: 'light', segment_id: 20 }),
    ]
    const result = rowsToReviewVocab(rows, [
      'https://signed.url/1.mp3',
      'https://signed.url/2.mp3',
    ])
    expect(result[0]!.audioUrl).toBe('https://signed.url/1.mp3')
    expect(result[1]!.audioUrl).toBe('https://signed.url/2.mp3')
  })

  it('phonetic/forms/exampleSentence/exampleTranslation 为 null 时保留 null', () => {
    const rows = [
      makeRow({
        phonetic: null,
        forms: null,
        exampleSentence: null,
        exampleTranslation: null,
        vocab_media_key: null,
      }),
    ]
    const result = rowsToReviewVocab(rows, [null])
    expect(result[0]!.phonetic).toBeNull()
    expect(result[0]!.forms).toBeNull()
    expect(result[0]!.exampleSentence).toBeNull()
    expect(result[0]!.exampleTranslation).toBeNull()
    expect(result[0]!.audioUrl).toBeNull()
  })

  it('空数组输入返回空数组', () => {
    const result = rowsToReviewVocab([], [])
    expect(result).toEqual([])
  })
})
