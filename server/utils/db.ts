// server/utils/db.ts
// 数据库连接
import mysql from 'mysql2/promise'

const config = useRuntimeConfig().db
export const pool = mysql.createPool({
  host: config.host || 'localhost',
  port: Number(config.port) || 3306,        // 转为数字，提供默认值
  user: config.user || 'root',
  password: config.password || '',
  database: config.database || 'nuxt4_demo',
  waitForConnections: true,
  connectionLimit: 10,
})

// 首次启动时自动建表
pool.execute(`
  CREATE TABLE IF NOT EXISTS user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account VARCHAR(20) NOT NULL UNIQUE,
    nickname VARCHAR(50),
    email VARCHAR(255) UNIQUE,
    passwordHash VARCHAR(255) NOT NULL,
    role INT NOT NULL DEFAULT 1,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`)

export default pool