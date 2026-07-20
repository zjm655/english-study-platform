import { describe, it, expect, vi } from 'vitest'
import type { SegmentRow } from '#server/types/db'

// 在所有 import 之前设置 Nuxt 自动注入的全局函数
vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

// mock 运行时依赖，避免触发 useRuntimeConfig
vi.mock('#server/utils/db', () => ({ query: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))
vi.mock('#server/utils/validate', () => ({
  validateError: vi.fn(),
  validateSuccess: vi.fn(),
}))

import { rowsToReviewMaterial } from '../material.get'

type ReviewRow = SegmentRow & { seg_media_key: string | null; seg_media_duration: string | null }

function makeRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: 1,
    unit_id: 1,
    title: '片段标题',
    audioUrl: null,
    duration: '12.50',
    media_id: null,
    textContent: '原文内容',
    translation: '中文翻译',
    questions: '[{"q":"问题1"}]',
    is_public: 1,
    sort_order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    seg_media_key: 'segments/1.mp3',
    seg_media_duration: '12.50',
    ...overrides,
  }
}

describe('rowsToReviewMaterial 数据转换', () => {
  it('正常行：映射 id/title/questions，duration 从 DECIMAL 字符串转 number', () => {
    const rows = [makeRow()]
    const result = rowsToReviewMaterial(rows, ['https://signed/1.mp3'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
    expect(result[0].title).toBe('片段标题')
    expect(result[0].questions).toBe('[{"q":"问题1"}]')
    expect(result[0].duration).toBe(12.5)
  })

  it('audioUrl 使用传入的签名 URL（按索引对应）', () => {
    const rows = [
      makeRow({ id: 1, seg_media_key: 'k1' }),
      makeRow({ id: 2, seg_media_key: 'k2' }),
    ]
    const result = rowsToReviewMaterial(rows, ['https://signed/1.mp3', 'https://signed/2.mp3'])
    expect(result[0].audioUrl).toBe('https://signed/1.mp3')
    expect(result[1].audioUrl).toBe('https://signed/2.mp3')
  })

  it('questions 为 null 时保留 null', () => {
    const rows = [makeRow({ questions: null })]
    const result = rowsToReviewMaterial(rows, ['https://signed/1.mp3'])
    expect(result[0].questions).toBeNull()
  })

  it('seg_media_duration 为 null 时返回 null（duration 仅取自 media 表）', () => {
    const rows = [makeRow({ seg_media_duration: null })]
    const result = rowsToReviewMaterial(rows, ['https://signed/1.mp3'])
    expect(result[0].duration).toBeNull()
  })

  it('空数组输入返回空数组', () => {
    expect(rowsToReviewMaterial([], [])).toEqual([])
  })
})
