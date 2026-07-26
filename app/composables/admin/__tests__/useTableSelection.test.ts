import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTableSelection } from '../useTableSelection'

// ===== useTableSelection 测试 =====
// 覆盖：向后兼容（无 options）/ canSelect 上限与已选行豁免（按 id 匹配新引用）/
// 表头全选溢出裁剪 / removeRow 单一真相源 / offPageCount / clear 双清与空 tableRef 容错

// toastWarning 弹层依赖，静默 mock
vi.mock('~/utils/popup', () => ({ toastWarning: vi.fn() }))

interface Row {
  id: number
  title: string
}

const row = (id: number): Row => ({ id, title: `t${id}` })
const rows = (...ids: number[]) => ids.map(row)

function mockTable() {
  return { clearSelection: vi.fn(), toggleRowSelection: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('向后兼容', () => {
  it('无 options 时 canSelect 恒 true，offPageCount 为选中总数（无 pageRows）', () => {
    const sel = useTableSelection<Row>()
    sel.onSelectionChange(rows(1, 2, 3))
    expect(sel.canSelect(row(99))).toBe(true)
    expect(sel.selectedIds.value).toEqual([1, 2, 3])
    // 未提供 pageRows：全部视为「不在当前页」
    expect(sel.offPageCount.value).toBe(3)
  })
})

describe('canSelect 上限', () => {
  it('未达上限 true；达上限新行 false；达上限但已选行（同 id 新对象）豁免 true', () => {
    const sel = useTableSelection<Row>({ limit: 2 })
    sel.onSelectionChange(rows(1, 2))
    expect(sel.canSelect(row(3))).toBe(false)
    // 已选行豁免按 id 匹配（重载后行对象是新引用）
    expect(sel.canSelect({ id: 1, title: 'reloaded' })).toBe(true)
    // 未达限时新行可选
    sel.onSelectionChange(rows(1))
    expect(sel.canSelect(row(3))).toBe(true)
  })
})

describe('表头全选溢出裁剪', () => {
  it('rows 超过 limit：超额尾部逐行 toggle off 且本地不更新', () => {
    const table = mockTable()
    const sel = useTableSelection<Row>({ limit: 3 })
    sel.tableRef.value = table
    sel.onSelectionChange(rows(1, 2))
    expect(sel.selectedRows.value.length).toBe(2)

    const overflow = rows(1, 2, 3, 4, 5)
    sel.onSelectionChange(overflow)
    // 超额的 4、5 被回滚
    expect(table.toggleRowSelection).toHaveBeenCalledTimes(2)
    expect(table.toggleRowSelection).toHaveBeenCalledWith(overflow[3], false)
    expect(table.toggleRowSelection).toHaveBeenCalledWith(overflow[4], false)
    // 本地保持上一次合法状态（等待回滚触发的下一轮 selection-change 收敛）
    expect(sel.selectedRows.value.map((r) => r.id)).toEqual([1, 2])
  })
})

describe('removeRow', () => {
  it('走表格 API（单一真相源），不直接改本地状态', () => {
    const table = mockTable()
    const sel = useTableSelection<Row>({ limit: 10 })
    sel.tableRef.value = table
    const selected = rows(1, 2)
    sel.onSelectionChange(selected)

    sel.removeRow(selected[0]!)
    expect(table.toggleRowSelection).toHaveBeenCalledWith(selected[0], false)
    // 本地状态由 selection-change 回流同步（EP 无条件 emit）——模拟回流
    expect(sel.selectedRows.value.length).toBe(2)
    sel.onSelectionChange(rows(2))
    expect(sel.selectedIds.value).toEqual([2])
  })

  it('tableRef 为 null 时不抛错', () => {
    const sel = useTableSelection<Row>()
    expect(() => sel.removeRow(row(1))).not.toThrow()
  })
})

describe('offPageCount', () => {
  it('计算选中集中不在当前页的行数', () => {
    let page: Row[] = rows(1, 2, 3)
    const sel = useTableSelection<Row>({ pageRows: () => page })
    sel.onSelectionChange(rows(1, 2, 8, 9))
    expect(sel.offPageCount.value).toBe(2) // 8、9 不在当前页

    // 翻页后当前页变化，offPageCount 跟随重算
    page = rows(8, 9)
    sel.onSelectionChange(rows(1, 2, 8, 9)) // 触发依赖更新
    expect(sel.offPageCount.value).toBe(2) // 1、2 不在当前页
  })
})

describe('clear', () => {
  it('清空 el-table 复选框（含跨页保留行）与本地状态', () => {
    const table = mockTable()
    const sel = useTableSelection<Row>()
    sel.tableRef.value = table
    sel.onSelectionChange(rows(1, 2))

    sel.clear()
    expect(table.clearSelection).toHaveBeenCalledTimes(1)
    expect(sel.selectedRows.value).toEqual([])
    expect(sel.offPageCount.value).toBe(0)
  })

  it('tableRef 为 null 时不抛错', () => {
    const sel = useTableSelection<Row>()
    sel.onSelectionChange(rows(1))
    expect(() => sel.clear()).not.toThrow()
    expect(sel.selectedRows.value).toEqual([])
  })
})
