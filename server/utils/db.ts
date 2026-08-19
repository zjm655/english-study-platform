// server/utils/db.ts
// 数据库连接
import mysql, { type PoolConnection } from 'mysql2/promise'

const config = useRuntimeConfig().db

/** 应用连接池上限（mysqlMonitor 展示用；全项目唯一来源） */
export const DB_POOL_LIMIT = 10

export const pool = mysql.createPool({
  host: config.host || 'localhost',
  port: Number(config.port) || 3306, // 转为数字，提供默认值
  user: config.user || 'root',
  password: config.password || '',
  database: config.database || 'nuxt4_demo',
  waitForConnections: true,
  connectionLimit: DB_POOL_LIMIT,
})

/** 泛型查询封装，避免调用方使用类型断言 */
export async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}

/** 事务工具：自动获取连接 → begin → commit/rollback → release */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  try {
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 数据库初始化说明：
 * 首次启动前，请运行 `npx tsx server/db/migrate.ts` 执行数据库迁移。
 * 数据库结构通过 server/db/migrations/ 目录中的迁移文件管理，
 * 禁止直接通过命令行或可视化工具修改数据库结构。
 */

export default pool
