/** 管理员单元管理共享类型（列表 / 新建 / 编辑） */

/** 单元列表项（id 是 segment.unit_id 的关联键，列表中突出展示） */
export interface AdminUnitListItem {
  id: number
  title: string
  description: string | null
  level: number // 自由数字等级：数字越大难度越高，0 = 系统保留的自定义单元
  sortOrder: number
  /** 单元下未删除材料数（删除确认提示影响面） */
  segmentCount: number
  createdAt: string
}

/** 单元列表查询参数（query string，后端 zod coerce） */
export interface AdminUnitListQuery {
  page?: number
  pageSize?: number
  level?: number // 0 = 用户自定义材料单元
  keyword?: string // 按标题模糊搜索
}

/** 单元列表响应（服务端分页） */
export interface AdminUnitListResult {
  list: AdminUnitListItem[]
  total: number
  page: number
  pageSize: number
}

/** 单元保存载荷（新建与编辑共用；level 为自由数字等级 ≥1，0 保留给自定义单元） */
export interface AdminUnitSavePayload {
  title: string
  description?: string | null
  level: number
  sortOrder: number
}
