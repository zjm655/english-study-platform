/**
 * 迁移排序规则（collation）配置模块。
 *
 * 设计意图：
 * - 迁移由 Node 24 原生运行（migrate.ts，type stripping，不依赖 tsx）在项目运行前执行，因此 collation 配置
 *   绝不能走 Nuxt runtimeConfig，必须直接读 .env / process.env（由 migrate.ts
 *   的 loadEnv 注入），改 .env 即生效，无需运行或构建项目。
 * - 本模块为纯函数、无副作用：不建立数据库连接、不读文件、import 不触发任何迁移
 *   动作，保证可被单元测试独立引用。
 * - 迁移 .sql 文件中所有 collation 值统一写作字面占位符 ${COLLATION}，执行前由
 *   applyCollation 替换为实际值，从而支持 MySQL 8.0+（默认 utf8mb4_0900_ai_ci）
 *   与低版本（utf8mb4_unicode_ci / utf8mb4_general_ci）之间一键切换。
 */

/** 默认排序规则：MySQL 8.0+ 的 utf8mb4 默认 collation，不配置时行为等同历史。 */
export const DEFAULT_COLLATION = 'utf8mb4_0900_ai_ci'

/** 已知的三种常用 collation，用于对未知值给出提醒（不阻断）。 */
const KNOWN_COLLATIONS = ['utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci', 'utf8mb4_general_ci']

/**
 * 解析迁移使用的 collation。
 *
 * 规则：
 * - 读 process.env.NUXT_DB_COLLATION；空串/未定义 → 返回 DEFAULT_COLLATION。
 * - 值必须匹配 /^[A-Za-z0-9_]+$/（collation 名仅含字母数字下划线），否则抛错。
 *   该校验是防 SQL 注入的关键：collation 值会被直接插值进 DDL 语句。
 * - 匹配格式但不在三种已知值内（如其它合法 collation 或拼写错误）：console.warn
 *   提示后放行，交由 MySQL 自身校验，避免误伤合法但未列举的 collation。
 */
export function resolveCollation(): string {
  const raw = process.env.NUXT_DB_COLLATION
  if (!raw) {
    return DEFAULT_COLLATION
  }
  if (!/^[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error(
      `[ERROR] NUXT_DB_COLLATION 非法: "${raw}"（仅允许字母、数字、下划线，防止 SQL 注入）`,
    )
  }
  if (!KNOWN_COLLATIONS.includes(raw)) {
    console.warn(
      `[WARN] NUXT_DB_COLLATION="${raw}" 不在已知列表(${KNOWN_COLLATIONS.join('/')})中，将按原值使用，请确认 MySQL 支持该排序规则`,
    )
  }
  return raw
}

/**
 * 把 SQL 文本中的所有 ${COLLATION} 占位符替换为实际 collation 值。
 *
 * 用 split/join 做字面量替换而非正则：占位符含 $ { } 等正则元字符，
 * 字面量替换绝不误伤其它 SQL 文本（如注释、COMMENT 字符串）。
 */
export function applyCollation(sql: string, collation: string): string {
  return sql.split('${COLLATION}').join(collation)
}
