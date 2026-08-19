/**
 * 权限目录：前后端单一真相源。
 * 管理后台各操作映射到权限键，实现细粒度管控；超级管理员隐式持有全部权限。
 */

/** 权限键常量 */
export const PERMISSIONS = {
  /** 材料管理：列表/编辑/删除/上传/记录/重处理 */
  MANAGE_MATERIALS: 'manage_materials',
  /** 用户管理：列表/详情/改资料/封禁/销号 */
  MANAGE_USERS: 'manage_users',
  /** 运营统计：统计概览 + 云服务用量 + 趋势 */
  VIEW_STATS: 'view_stats',
  /** 日志查看：API/云服务/操作日志 查看/导出/清理 */
  VIEW_LOGS: 'view_logs',
  /** 系统配置：限流等 */
  CONFIG: 'config',
  /** 审核门禁：试听非公开用户材料/配音 */
  REVIEW: 'review',
  /** 审计查看：审核留痕查询导出（监督 REVIEW 持有者，不默认下放） */
  VIEW_AUDIT: 'view_audit',
  /** 公告管理：系统公告的增删改查与发布/撤回 */
  MANAGE_NOTICES: 'manage_notices',
  /** 授权管理：改角色 + 授予权限（超管隐式持有，不通过权限表下放） */
  GRANT_PERMISSIONS: 'grant_permissions',
  /** 运维备份：触发 Redis RDB 备份（超管隐式持有，不默认下放） */
  OPS_BACKUP: 'ops_backup',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** 全部权限键（超管的哨兵集合） */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionKey[]

/** 权限中文标签（授权 UI 展示用） */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  [PERMISSIONS.MANAGE_MATERIALS]: '材料管理',
  [PERMISSIONS.MANAGE_USERS]: '用户管理',
  [PERMISSIONS.VIEW_STATS]: '运营统计',
  [PERMISSIONS.VIEW_LOGS]: '日志查看',
  [PERMISSIONS.CONFIG]: '系统配置',
  [PERMISSIONS.REVIEW]: '审核门禁',
  [PERMISSIONS.VIEW_AUDIT]: '审计查看',
  [PERMISSIONS.MANAGE_NOTICES]: '公告管理',
  [PERMISSIONS.GRANT_PERMISSIONS]: '授权管理',
  [PERMISSIONS.OPS_BACKUP]: '运维备份',
}

/**
 * 可授予权限（授权 UI 可勾选项）= 全部权限去掉 grant_permissions。
 * grant_permissions 为超管专属，不通过权限表下放，仅随 ROLE_SUPER_ADMIN 隐式持有。
 */
export const GRANTABLE_PERMISSIONS: PermissionKey[] = ALL_PERMISSIONS.filter(
  (p) => p !== PERMISSIONS.GRANT_PERMISSIONS,
)

/**
 * 存量管理员默认权限（迁移回填用）。
 * 刻意排除 review（审核是全新敏感能力，不默认下放给存量管理员，由超管显式授予）
 * 与 grant_permissions（超管专属）。
 */
export const DEFAULT_ADMIN_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.MANAGE_MATERIALS,
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.VIEW_STATS,
  PERMISSIONS.VIEW_LOGS,
  PERMISSIONS.CONFIG,
]

/** 审核门禁——查看理由类别白名单（审计留痕用） */
export const REVIEW_REASON_CATEGORIES = [
  '内容合规审查',
  '用户申诉核实',
  '质量抽查',
  '违规举报处理',
  '其他',
] as const

export type ReviewReasonCategory = (typeof REVIEW_REASON_CATEGORIES)[number]

/**
 * 审核留痕对象类型（与 writeReviewAccessLog 各写入点的 target_type 取值一致）。
 * 前端筛选下拉与后端 zod 枚举共用，防两处漂移。
 */
export const REVIEW_TARGET_TYPES = [
  'segment',
  'material_record',
  'recording',
  'segment_visibility',
] as const

export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number]

/** 审核留痕对象类型中文标签（留痕查询页展示用） */
export const REVIEW_TARGET_TYPE_LABELS: Record<ReviewTargetType, string> = {
  segment: '材料试听',
  material_record: '上传记录试听',
  recording: '配音详情查看',
  segment_visibility: '公开状态调整',
}
