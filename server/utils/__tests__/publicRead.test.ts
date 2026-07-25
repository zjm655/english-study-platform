import { describe, it, expect } from 'vitest'
import { isPublicReadPath } from '../publicRead'

describe('isPublicReadPath - 公开只读路径判定', () => {
  it('GET /api/units 命中（含带 query 的 event.path）', () => {
    expect(isPublicReadPath('GET', '/api/units')).toBe(true)
    expect(isPublicReadPath('GET', '/api/units?level=1')).toBe(true)
  })

  it('GET /api/units/:id/progress 命中（含带 query）', () => {
    expect(isPublicReadPath('GET', '/api/units/12/progress')).toBe(true)
    expect(isPublicReadPath('GET', '/api/units/12/progress?page=2&pageSize=10')).toBe(true)
  })

  it('非 GET 方法不命中', () => {
    expect(isPublicReadPath('POST', '/api/units')).toBe(false)
    expect(isPublicReadPath('DELETE', '/api/units/12/progress')).toBe(false)
  })

  it('相近路径不命中（正则边界）', () => {
    expect(isPublicReadPath('GET', '/api/units/abc/progress')).toBe(false)
    expect(isPublicReadPath('GET', '/api/units/12')).toBe(false)
    expect(isPublicReadPath('GET', '/api/units/12/progress/extra')).toBe(false)
    expect(isPublicReadPath('GET', '/api/unitsX')).toBe(false)
    expect(isPublicReadPath('GET', '/api/user/verify')).toBe(false)
  })
})
