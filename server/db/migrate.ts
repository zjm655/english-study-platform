import mysql from 'mysql2/promise'
import { readdir, readFile, access } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { resolveCollation, applyCollation } from './collation'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function loadEnv() {
  const envPath = join(__dirname, '../../.env')
  try {
    await access(envPath)
    const content = await readFile(envPath, 'utf-8')
    content.split('\n').forEach((line) => {
      line = line.trim()
      if (!line || line.startsWith('#')) return
      const match = line.match(/^([^=]+)=(.+)$/)
      if (match && match[1] && match[2]) {
        let value = match[2].trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        process.env[match[1].trim()] = value
      }
    })
  } catch {
    console.log('[INFO] .env 文件不存在，使用默认配置')
  }
}

async function main() {
  const force = process.argv.includes('--force')

  await loadEnv()

  // 解析迁移排序规则：直读 process.env（loadEnv 已注入 .env），不走 Nuxt runtimeConfig，
  // 改 .env 即生效、无需运行或构建项目。非法值在此处直接抛错终止迁移。
  const collation = resolveCollation()
  console.log(`[INFO] 迁移 collation: ${collation}`)

  const config = {
    host: process.env.NUXT_DB_HOST || '127.0.0.1',
    port: Number(process.env.NUXT_DB_PORT) || 3306,
    user: process.env.NUXT_DB_USER || 'root',
    password: process.env.NUXT_DB_PASSWORD || '',
    database: process.env.NUXT_DB_DATABASE || 'nuxt4_demo',
  }

  console.log('[INFO] 连接数据库:', config.host, ':', config.port, '/', config.database)

  let connection: mysql.Connection | null = null
  try {
    connection = await mysql.createConnection(config)

    // 允许向自增列插入字面量 0：002 种子数据需插入 unit id=0（用户自定义材料保留单元），
    // MySQL 默认 sql_mode 下插 0 会被当作「生成下一个自增值」。用 query()（文本协议）确保 SET 表达式生效，
    // 避免 execute()（预编译协议）对 SET ... = CONCAT(...) 的兼容风险。该设置对整个迁移会话生效。
    await connection.query(
      "SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO')",
    )

    await ensureMigrationsTable(connection, collation)

    const executedVersions = await getExecutedVersions(connection)
    console.log(
      '[INFO] 已执行的迁移版本:',
      executedVersions.length > 0 ? executedVersions.join(', ') : '无',
    )

    const migrationFiles = await getMigrationFiles()
    console.log('[INFO] 发现迁移文件:', migrationFiles.length, '个')

    let executedCount = 0
    for (const file of migrationFiles) {
      const version = file.version
      const filename = file.filename

      if (!force && executedVersions.includes(version)) {
        console.log('[SKIP]', filename, '- 已执行')
        continue
      }

      if (version === '001') {
        const tablesExist = await checkExistingTables(connection)
        if (tablesExist) {
          console.log('[SKIP]', filename, '- 数据库已存在表结构，跳过初始迁移')
          await markAsExecuted(connection, version, filename)
          executedCount++
          continue
        }
      }

      console.log('[EXEC]', filename)
      await executeMigrationFile(connection, filename, version, collation)
      executedCount++
      console.log('[DONE]', filename)
    }

    if (executedCount === 0) {
      console.log('[INFO] 没有需要执行的迁移')
    } else {
      console.log('[INFO] 迁移完成，共执行', executedCount, '个文件')
    }
  } catch (error) {
    console.error('[ERROR] 迁移失败:', error)
    process.exit(1)
  } finally {
    if (connection) {
      await connection.end()
    }
  }
}

async function ensureMigrationsTable(connection: mysql.Connection, collation: string) {
  // collation 已经 resolveCollation 正则白名单校验，可安全插值；
  // CREATE TABLE IF NOT EXISTS 对已存在的库无副作用（不会改动既有表的排序规则）。
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(50) NOT NULL COMMENT '迁移版本号（如 001）',
      filename VARCHAR(255) NOT NULL COMMENT '迁移文件名',
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_version (version)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = ${collation} COMMENT = '数据库迁移版本记录表';
  `
  await connection.execute(createTableSQL)
}

async function getExecutedVersions(connection: mysql.Connection): Promise<string[]> {
  const [rows] = await connection.execute('SELECT version FROM migrations')
  const versionRows = rows as { version: string }[]
  return versionRows.map((r) => r.version)
}

async function checkExistingTables(connection: mysql.Connection): Promise<boolean> {
  // 校验多张核心表均存在才判定「已初始化」，避免部分建库被误判跳过 001。
  // 表名为硬编码常量，无注入风险；直接拼接以规避 SHOW 语句预编译参数兼容问题。
  const coreTables = ['user', 'unit', 'segment']
  for (const table of coreTables) {
    const [rows] = await connection.execute(`SHOW TABLES LIKE '${table}'`)
    if (!Array.isArray(rows) || rows.length === 0) {
      return false
    }
  }
  return true
}

async function markAsExecuted(connection: mysql.Connection, version: string, filename: string) {
  // INSERT IGNORE 保证幂等：--force 重跑或 001 走「表已存在」分支时，版本已存在则忽略，不报唯一键冲突。
  await connection.execute('INSERT IGNORE INTO migrations (version, filename) VALUES (?, ?)', [
    version,
    filename,
  ])
}

async function getMigrationFiles(): Promise<{ version: string; filename: string }[]> {
  const migrationsDir = join(__dirname, 'migrations')
  const files = await readdir(migrationsDir)

  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const match = f.match(/^(\d{3})_/)
      const versionStr = match?.[1]
      return {
        version: versionStr ?? f,
        filename: f,
        sortKey: versionStr ? parseInt(versionStr) : 9999,
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)

  return sqlFiles.map((f) => ({ version: f.version, filename: f.filename }))
}

async function executeMigrationFile(
  connection: mysql.Connection,
  filename: string,
  version: string,
  collation: string,
) {
  const filePath = join(__dirname, 'migrations', filename)
  const content = await readFile(filePath, 'utf-8')

  // 把 .sql 中的 ${COLLATION} 占位符替换为实际排序规则（字面量替换，不误伤其它文本）
  const replaced = applyCollation(content, collation)

  // 先按行剥离 `--` 单行注释与 `/* */` 块注释，再按 `;` 切分语句。
  // 旧实现按 `;` 切分后过滤 startsWith('--') 的块，会把「注释行 + 语句」整块丢弃
  // （如 002 种子数据 INSERT 紧跟注释行），导致语句被静默跳过、新库缺失数据。
  // 已知限制：不处理字符串字面量内的 `;`（现有迁移文件均为中文文本，无内嵌分号）。
  const stripped = replaced
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    // SET 语句（如 001 的 SET NAMES / SET FOREIGN_KEY_CHECKS）必须走 query()（文本协议）：
    // mysql2 的 execute() 用预编译协议，SET FOREIGN_KEY_CHECKS 等会话级 SET 会报
    // ER_UNSUPPORTED_PS (1295)「This command is not supported in the prepared statement protocol yet」，
    // 全新库（如 docker migrate）执行 001 必然失败。
    // 其余语句保持 execute()（预编译协议，参数化与类型安全）。
    if (/^SET\b/i.test(stmt)) {
      await connection.query(stmt)
    } else {
      await connection.execute(stmt)
    }
  }

  await markAsExecuted(connection, version, filename)
}

main()
