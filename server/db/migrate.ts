import mysql from 'mysql2/promise'
import { readdir, readFile, access } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function loadEnv() {
  const envPath = join(__dirname, '../../.env')
  try {
    await access(envPath)
    const content = await readFile(envPath, 'utf-8')
    content.split('\n').forEach(line => {
      line = line.trim()
      if (!line || line.startsWith('#')) return
      const match = line.match(/^([^=]+)=(.+)$/)
      if (match && match[1] && match[2]) {
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

    await ensureMigrationsTable(connection)

    const executedVersions = await getExecutedVersions(connection)
    console.log('[INFO] 已执行的迁移版本:', executedVersions.length > 0 ? executedVersions.join(', ') : '无')

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
      await executeMigrationFile(connection, filename, version)
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

async function ensureMigrationsTable(connection: mysql.Connection) {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(50) NOT NULL COMMENT '迁移版本号（如 001）',
      filename VARCHAR(255) NOT NULL COMMENT '迁移文件名',
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_version (version)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '数据库迁移版本记录表';
  `
  await connection.execute(createTableSQL)
}

async function getExecutedVersions(connection: mysql.Connection): Promise<string[]> {
  const [rows] = await connection.execute('SELECT version FROM migrations')
  const versionRows = rows as { version: string }[]
  return versionRows.map(r => r.version)
}

async function checkExistingTables(connection: mysql.Connection): Promise<boolean> {
  const [rows] = await connection.execute(
    "SHOW TABLES LIKE 'user'"
  )
  return Array.isArray(rows) && rows.length > 0
}

async function markAsExecuted(connection: mysql.Connection, version: string, filename: string) {
  await connection.execute(
    'INSERT INTO migrations (version, filename) VALUES (?, ?)',
    [version, filename]
  )
}

async function getMigrationFiles(): Promise<{ version: string; filename: string }[]> {
  const migrationsDir = join(__dirname, 'migrations')
  const files = await readdir(migrationsDir)

  const sqlFiles = files
    .filter(f => f.endsWith('.sql'))
    .map(f => {
      const match = f.match(/^(\d{3})_/)
      const versionStr = match?.[1]
      return {
        version: versionStr ?? f,
        filename: f,
        sortKey: versionStr ? parseInt(versionStr) : 9999,
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)

  return sqlFiles.map(f => ({ version: f.version, filename: f.filename }))
}

async function executeMigrationFile(connection: mysql.Connection, filename: string, version: string) {
  const filePath = join(__dirname, 'migrations', filename)
  const content = await readFile(filePath, 'utf-8')

  const statements = content
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'))

  for (const stmt of statements) {
    await connection.execute(stmt)
  }

  await connection.execute(
    'INSERT INTO migrations (version, filename) VALUES (?, ?)',
    [version, filename]
  )
}

main()