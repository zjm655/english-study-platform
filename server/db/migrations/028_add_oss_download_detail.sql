-- xxx_add_oss_download_detail.sql
-- OSS 下载明细表（替代 oss_playback_daily 聚合表），支持细粒度统计分析
-- 
-- 设计要点：
-- 1. 记录每次播放的实际音频大小（MB）→ 精确成本核算
-- 2. guest_key 关联访客身份 → 可统计单访客用量
-- 3. material_id 关联具体素材 → 可分析热门/冷门内容
-- 4. played_at 时间戳 → 可绘制趋势图、发现异常流量
-- 5. 索引策略：(guest_key, played_at) 支持访客用量查询；(material_id, played_at) 支持素材热度分析
-- 
-- 使用场景：
-- - 管理员后台：每日播放量趋势图 + 总量卡片 + Top10 素材排行
-- - 限流监控：单访客每小时播放次数/总流量
-- - 成本核算：SUM(audio_size_mb) × 单价 = 实际费用

CREATE TABLE `oss_download_detail` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `guest_key` VARCHAR(36) NOT NULL COMMENT '游客身份键（null 代表登录用户）',
  `material_id` INT NOT NULL COMMENT '材料 ID（segment_id/vocabulary_id/recording_id）',
  `material_type` VARCHAR(20) NOT NULL COMMENT '材料类型：segment/vocab/recording',
  `played_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '播放时间',
  `audio_size_mb` DECIMAL(5,2) NOT NULL COMMENT '音频实际大小（MB）',
  `user_id` INT DEFAULT NULL COMMENT '登录用户 ID（有值则 guest_key 为 null）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_material_time` (`material_id`, `played_at`), -- 防重复上报同一素材同一秒
  INDEX `idx_guest_time` (`guest_key`, `played_at`),          -- 访客用量查询
  INDEX `idx_material` (`material_id`, `played_at`),          -- 素材热度分析
  INDEX `idx_user_time` (`user_id`, `played_at`)              -- 用户行为分析
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = ${COLLATION} COMMENT = 'OSS 下载明细表（替换 oss_playback_daily）';

-- 可选：初始化历史数据从 oss_playback_daily 迁移（需按物料维度补充 audio_size_mb 系数）
-- INSERT INTO oss_download_detail (guest_key, material_id, material_type, played_at, audio_size_mb, user_id)
-- SELECT gk, mat_id, 'unknown', played_at, avg_audio_mb, uid
-- FROM oss_playback_daily;
