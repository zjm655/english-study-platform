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
      streakDays INT NOT NULL DEFAULT 0 COMMENT '连续学习天数',
      totalStudyMinutes INT NOT NULL DEFAULT 0 COMMENT '累计学习时长(分钟)',
      role INT NOT NULL DEFAULT 0 COMMENT '角色: 0普通用户 1管理员',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  // 单元表 —— 学习单元容器，按难度分级
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS unit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(100) NOT NULL COMMENT '单元标题',
      description VARCHAR(500) COMMENT '单元简介',
      coverUrl VARCHAR(1024) COMMENT '封面图URL',
      level INT NOT NULL DEFAULT 1 COMMENT '难度等级: 1初级 2中级 3高级',
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
      textContent TEXT NOT NULL COMMENT '英文原文，四阶段核心素材',
      translation TEXT COMMENT '中文翻译，辅助理解',
      questions JSON COMMENT '盲听理解题，JSON数组格式',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '同单元内的排序',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (unit_id) REFERENCES unit(id) ON DELETE CASCADE
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

  // 共同体帖子表 —— 用户发帖交流
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS community_post (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT '发帖用户',
      title VARCHAR(200) NOT NULL COMMENT '帖子标题',
      content TEXT NOT NULL COMMENT '帖子内容',
      likeCount INT NOT NULL DEFAULT 0 COMMENT '点赞数',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
      FOREIGN KEY (user_id) REFERENCES user(id)
    )
  `)
}
initDB().catch(err => console.error('[DB] 建表失败:', err))

export default pool