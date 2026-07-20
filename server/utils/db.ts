// server/utils/db.ts
// 数据库连接
import mysql, { type PoolConnection } from 'mysql2/promise'

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

/** 泛型查询封装，避免调用方使用类型断言 */
export async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as mysql.ExecuteValues)
  return rows as T[]
}

/** 事务工具：自动获取连接 → begin → commit/rollback → release */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
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

// 首次启动时自动建表（按外键依赖顺序）
const initDB = async () => {
  // 用户表
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(20) NOT NULL UNIQUE,
      nickname VARCHAR(50),
      email VARCHAR(255) UNIQUE,
      passwordHash VARCHAR(255) NOT NULL,
      avatarUrl VARCHAR(1024) COMMENT '头像URL',
      level INT NOT NULL DEFAULT 0 COMMENT '用户等级: 0未测试 1初级 2中级 3高级',
      role INT NOT NULL DEFAULT 0 COMMENT '角色: 0普通用户 1管理员',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  // 用户打卡统计表 —— 每用户一条记录，存储汇总统计
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_checkin_stats (
      user_id INT PRIMARY KEY COMMENT '用户ID',
      total_checkin_days INT NOT NULL DEFAULT 0 COMMENT '总打卡天数',
      last_checkin_time DATETIME COMMENT '上次打卡时间',
      current_streak_days INT NOT NULL DEFAULT 0 COMMENT '当前连续天数',
      max_streak_days INT NOT NULL DEFAULT 0 COMMENT '最大连续天数',
      total_study_seconds INT NOT NULL DEFAULT 0 COMMENT '累计学习时长(秒)',
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    )
  `)

  // 用户打卡记录表 —— 每用户每天一条记录，存储每日明细
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_checkin_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '用户ID',
      checkin_date DATE NOT NULL COMMENT '打卡日期',
      checked_in TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已签到: 0未签到 1已签到',
      study_seconds INT NOT NULL DEFAULT 0 COMMENT '当天学习时长(秒)',
      segments_completed INT NOT NULL DEFAULT 0 COMMENT '当天完成片段数',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_date (user_id, checkin_date) COMMENT '防止重复打卡',
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    )
  `)

  // 单元表 —— 学习单元容器，按难度分级
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS unit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(100) NOT NULL COMMENT '单元标题',
      description VARCHAR(500) COMMENT '单元简介',
      coverUrl VARCHAR(1024) COMMENT '封面图URL',
      cover_media_id INT COMMENT '关联的封面媒体资源ID (media.id)',
      level INT NOT NULL DEFAULT 1 COMMENT '难度等级: 1初级 2中级 3高级，0为用户自定义',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '同级内的排序',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 片段表 —— 四阶段练习的核心素材（文本+音频）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS segment (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unit_id INT NOT NULL COMMENT '所属单元',
      title VARCHAR(100) NOT NULL COMMENT '片段标题',
      audioUrl VARCHAR(1024) COMMENT '原生音频地址，盲听/配音/影子跟读使用',
      duration DECIMAL(6,2) COMMENT '音频时长(秒)',
      textContent TEXT NOT NULL COMMENT '英文原文，四阶段核心素材',
      translation TEXT COMMENT '中文翻译，辅助理解',
      questions JSON COMMENT '盲听理解题，JSON数组格式',
      is_public TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否公开: 0不公开 1公开',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '同单元内的排序',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (unit_id) REFERENCES unit(id) ON DELETE CASCADE
    )
  `)

  // 词库表 —— 按难度分级的单词库，用于生成材料和查词
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS word_bank (
      id INT AUTO_INCREMENT PRIMARY KEY,
      word VARCHAR(100) NOT NULL COMMENT '英文原词',
      phonetic VARCHAR(100) COMMENT '音标，如 /ˈʃædoʊ/',
      meaning VARCHAR(500) NOT NULL COMMENT '中文释义',
      forms VARCHAR(500) COMMENT '词形变化，逗号分隔',
      exampleSentence TEXT COMMENT '英文例句',
      exampleTranslation TEXT COMMENT '例句中文翻译',
      audioUrl VARCHAR(1024) COMMENT '单词发音音频',
      duration DECIMAL(6,2) COMMENT '单词发音时长(秒)',
      level INT NOT NULL COMMENT '难度: 1小学 2初中 3高中 4四级 5六级',
      source VARCHAR(200) COMMENT '来源，如人教版小学三年级上册',
      frequency INT NOT NULL DEFAULT 0 COMMENT '词频/优先级，数字越大越常用',
      tags VARCHAR(500) COMMENT '标签，如名词,动物,基础',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_word_level (word, level)
    )
  `)

  // 词汇表 —— 片段内重点单词的知识点，支撑点击查词
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      segment_id INT NOT NULL COMMENT '所属片段',
      word VARCHAR(100) NOT NULL COMMENT '英文原词',
      forms VARCHAR(500) COMMENT '词形变化，逗号分隔，如 shadows,shadowed,shadowing',
      phonetic VARCHAR(100) COMMENT '音标，如 /ˈʃædoʊ/',
      meaning VARCHAR(500) NOT NULL COMMENT '中文释义',
      exampleSentence TEXT COMMENT '英文例句',
      exampleTranslation TEXT COMMENT '例句中文翻译',
      audioUrl VARCHAR(1024) COMMENT '单词发音音频地址',
      duration DECIMAL(6,2) COMMENT '单词发音时长(秒)',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '在片段中的出现顺序',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (segment_id) REFERENCES segment(id) ON DELETE CASCADE
    )
  `)

  // 用户进度表 —— 每个用户对每个片段的四阶段完成情况（汇总）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_progress (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '用户ID',
      segment_id INT NOT NULL COMMENT '片段ID',
      phase1_done TINYINT(1) NOT NULL DEFAULT 0 COMMENT '阶段一盲听是否完成',
      phase2_done TINYINT(1) NOT NULL DEFAULT 0 COMMENT '阶段二学习是否完成',
      phase3_done TINYINT(1) NOT NULL DEFAULT 0 COMMENT '阶段三配音是否完成',
      phase3_score DECIMAL(5,2) COMMENT '阶段三最高分',
      phase4_done TINYINT(1) NOT NULL DEFAULT 0 COMMENT '阶段四影子跟读是否完成',
      phase4_score DECIMAL(5,2) COMMENT '阶段四最高分',
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
      FOREIGN KEY (user_id) REFERENCES user(id),
      FOREIGN KEY (segment_id) REFERENCES segment(id) ON DELETE CASCADE,
      UNIQUE KEY uk_user_segment (user_id, segment_id)
    )
  `)

  // 录音记录表 —— 每次录音的完整记录，含AI评测数据
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recording (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '用户ID',
      segment_id INT NOT NULL COMMENT '片段ID',
      phase INT NOT NULL COMMENT '阶段3(配音)或阶段4(影子跟读)',
      audioPath VARCHAR(1024) COMMENT '录音文件存储路径',
      score DECIMAL(5,2) COMMENT '综合评分',
      feedback TEXT COMMENT 'AI整体评价建议',
      recognizedText TEXT COMMENT 'AI识别出的用户实际朗读文本',
      wordScores JSON COMMENT '逐词评分，如[{"word":"shadow","score":95,"status":"correct"}]',
      duration DECIMAL(8,2) COMMENT '录音时长(秒)',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
      FOREIGN KEY (user_id) REFERENCES user(id),
      FOREIGN KEY (segment_id) REFERENCES segment(id) ON DELETE CASCADE
    )
  `)

  // 收藏单词表 —— 用户收藏的重点单词
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_fav_word (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '用户ID',
      vocabulary_id INT NOT NULL COMMENT '收藏的单词ID',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
      FOREIGN KEY (user_id) REFERENCES user(id),
      FOREIGN KEY (vocabulary_id) REFERENCES vocabulary(id) ON DELETE CASCADE,
      UNIQUE KEY uk_user_vocab (user_id, vocabulary_id)
    )
  `)

  // 收藏片段表 —— 用户收藏的练习片段
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_fav_segment (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '用户ID',
      segment_id INT NOT NULL COMMENT '收藏的片段ID',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
      FOREIGN KEY (user_id) REFERENCES user(id),
      FOREIGN KEY (segment_id) REFERENCES segment(id) ON DELETE CASCADE,
      UNIQUE KEY uk_user_segment (user_id, segment_id)
    )
  `)

  // 媒体资源表 —— 统一管理所有音频、图片等媒体文件
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS media (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uploader_id INT COMMENT '上传者用户ID，NULL表示系统/TTS生成',
      type VARCHAR(20) NOT NULL COMMENT '类型: segment_audio/vocab_audio/word_audio/recording/cover/tts/user_material',
      storage_type VARCHAR(10) NOT NULL DEFAULT 'oss' COMMENT '存储方式: oss/local',
      bucket VARCHAR(100) COMMENT 'OSS bucket',
      object_key VARCHAR(1024) NOT NULL COMMENT 'OSS对象键或本地路径',
      original_name VARCHAR(255) COMMENT '原始文件名',
      mime_type VARCHAR(100) COMMENT 'MIME类型，如 audio/mpeg',
      size_bytes INT UNSIGNED COMMENT '文件大小(字节)',
      duration DECIMAL(8,2) COMMENT '时长(秒)',
      status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '状态: 0禁用 1正常',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间'
    )
  `)

  // 材料上传记录表 —— 追踪每一次上传尝试（成功或失败）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS material_upload_record (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '上传用户ID',
      title VARCHAR(100) NOT NULL COMMENT '材料标题',
      text_content TEXT NOT NULL COMMENT '材料原文',
      voice VARCHAR(50) NOT NULL DEFAULT 'en-US-AriaNeural' COMMENT '朗读音色',
      is_public TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否公开: 0不公开 1公开',
      status VARCHAR(20) NOT NULL DEFAULT 'processing' COMMENT '状态: processing/success/failed',
      error_message VARCHAR(500) COMMENT '失败原因',
      segment_id INT DEFAULT NULL COMMENT '关联的片段ID（成功时填充）',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
      FOREIGN KEY (segment_id) REFERENCES segment(id) ON DELETE SET NULL,
      INDEX idx_user_created (user_id, createdAt),
      INDEX idx_status (status)
    )
  `)
}
initDB().catch(err => logger.error('[DB] 建表失败:', err))

export default pool