// shared/schemas/batch.ts
// 管理后台批量操作 schema（材料/单元/上传记录/用户四域）。
import { z } from 'zod'

/** 批量 ids 数组：去重正整数，默认上限 100 */
const batchIds = (max = 100) =>
  z
    .array(z.number().int().positive('id 必须为正整数'))
    .min(1, 'ids 不能为空')
    .max(max, `ids 数量不能超过 ${max}`)
    .transform((arr) => [...new Set(arr)])

/** 材料批量操作校验（delete=批量软删 / move=批量修改所属单元） */
export const adminSegmentBatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: batchIds() }),
  z.object({
    action: z.literal('move'),
    ids: batchIds(),
    unitId: z.number().int().min(0, 'unitId 不能为负数'),
  }),
])

/** 单元批量操作校验（仅 delete） */
export const adminUnitBatchSchema = z.object({
  action: z.literal('delete'),
  ids: batchIds(),
})

/** 上传记录批量操作校验（delete / reprocess，reprocess 上限 20 与批量上传对齐防挤爆队列） */
export const adminMaterialRecordBatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: batchIds() }),
  z.object({
    action: z.literal('reprocess'),
    ids: batchIds(20),
    unitId: z.number().int().min(0, 'unitId 不能为负数'),
  }),
])

/** 用户批量操作校验（ban=封禁 / unban=解封 / delete=销号） */
export const adminUserBatchSchema = z.object({
  action: z.enum(['ban', 'unban', 'delete'], { message: 'action 必须为 ban/unban/delete' }),
  ids: batchIds(),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 材料批量操作请求（delete=批量软删；move=批量修改所属单元；z.input，ids 的 transform 不改变 input 类型） */
export type AdminSegmentBatchPayload = z.input<typeof adminSegmentBatchSchema>

/** 单元批量操作请求（仅批量软删；z.input） */
export type AdminUnitBatchPayload = z.input<typeof adminUnitBatchSchema>

/** 上传记录批量操作请求（delete=批量删除；reprocess=批量重试，ids ≤20；z.input） */
export type AdminMaterialRecordBatchPayload = z.input<typeof adminMaterialRecordBatchSchema>

/** 用户批量操作请求（ban=封禁 / unban=解封 / delete=销号；z.input） */
export type AdminUserBatchPayload = z.input<typeof adminUserBatchSchema>
