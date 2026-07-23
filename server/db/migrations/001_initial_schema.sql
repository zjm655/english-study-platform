/*
 Navicat Premium Dump SQL

 Source Server         : 本地
 Source Server Type    : MySQL
 Source Server Version : 80019 (8.0.19)
 Source Host           : localhost:3306
 Source Schema         : nuxt4_demo

 Target Server Type    : MySQL
 Target Server Version : 80019 (8.0.19)
 File Encoding         : 65001

 Date: 20/07/2026 15:01:32
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for material_upload_record
-- ----------------------------
DROP TABLE IF EXISTS `material_upload_record`;
CREATE TABLE `material_upload_record`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '上传用户ID',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '材料标题',
  `text_content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '材料原文',
  `voice` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'en-US-AriaNeural' COMMENT '朗读音色',
  `is_public` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否公开: 0不公开 1公开',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'processing' COMMENT '状态: processing/success/failed',
  `error_message` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '失败原因',
  `segment_id` int NULL DEFAULT NULL COMMENT '关联的片段ID（成功时填充）',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `segment_id`(`segment_id` ASC) USING BTREE,
  INDEX `idx_user_created`(`user_id` ASC, `createdAt` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE,
  CONSTRAINT `material_upload_record_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `material_upload_record_ibfk_2` FOREIGN KEY (`segment_id`) REFERENCES `segment` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for media
-- ----------------------------
DROP TABLE IF EXISTS `media`;
CREATE TABLE `media`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `uploader_id` int NULL DEFAULT NULL COMMENT '上传者用户ID，NULL表示系统/TTS生成',
  `type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '类型: segment_audio/vocab_audio/word_audio/recording/cover/tts/user_material',
  `storage_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'oss' COMMENT '存储方式: oss/local',
  `bucket` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT 'OSS bucket',
  `object_key` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT 'OSS对象键或本地路径',
  `original_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '原始文件名',
  `mime_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT 'MIME类型，如 audio/mpeg',
  `size_bytes` int UNSIGNED NULL DEFAULT NULL COMMENT '文件大小(字节)',
  `duration` decimal(8, 2) NULL DEFAULT NULL COMMENT '时长(秒)',
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '状态: 0禁用 1正常',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 291 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for recording
-- ----------------------------
DROP TABLE IF EXISTS `recording`;
CREATE TABLE `recording`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `segment_id` int NOT NULL COMMENT '片段ID',
  `phase` int NOT NULL COMMENT '阶段3(配音)或阶段4(影子跟读)',
  `score` decimal(5, 2) NULL DEFAULT NULL COMMENT '综合评分',
  `feedback` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT 'AI整体评价建议',
  `recognizedText` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT 'AI识别出的用户实际朗读文本',
  `wordScores` json NULL COMMENT '逐词评分，如[{\"word\":\"shadow\",\"score\":95,\"status\":\"correct\"}]',
  `duration` decimal(8, 2) NULL DEFAULT NULL COMMENT '录音时长(秒)',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  `media_id` int NULL DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)',
  `rawResult` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT 'SDK评测原始响应JSON',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `user_id`(`user_id` ASC) USING BTREE,
  INDEX `segment_id`(`segment_id` ASC) USING BTREE,
  CONSTRAINT `recording_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `recording_ibfk_2` FOREIGN KEY (`segment_id`) REFERENCES `segment` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 45 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for segment
-- ----------------------------
DROP TABLE IF EXISTS `segment`;
CREATE TABLE `segment`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `unit_id` int NOT NULL COMMENT '所属单元',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '片段标题',
  `textContent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '英文原文，四阶段核心素材',
  `translation` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '中文翻译，辅助理解',
  `questions` json NULL COMMENT '盲听理解题，JSON数组格式',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '同单元内的排序',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `media_id` int NULL DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)',
  `is_public` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否公开: 0不公开 1公开',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `unit_id`(`unit_id` ASC) USING BTREE,
  CONSTRAINT `segment_ibfk_1` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 28 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for unit
-- ----------------------------
DROP TABLE IF EXISTS `unit`;
CREATE TABLE `unit`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '单元标题',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '单元简介',
  `level` int NOT NULL DEFAULT 1 COMMENT '难度等级: 1初级 2中级 3高级',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '同级内的排序',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cover_media_id` int NULL DEFAULT NULL COMMENT '关联的封面媒体资源ID (media.id)',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user
-- ----------------------------
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `account` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `nickname` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL,
  `passwordHash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `avatarUrl` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '头像URL',
  `level` int NOT NULL DEFAULT 0 COMMENT '用户等级: 0未测试 1初级 2中级 3高级',
  `role` int NOT NULL DEFAULT 0 COMMENT '角色: 0普通用户 1管理员',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `account`(`account` ASC) USING BTREE,
  UNIQUE INDEX `email`(`email` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user_checkin_log
-- ----------------------------
DROP TABLE IF EXISTS `user_checkin_log`;
CREATE TABLE `user_checkin_log`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `checkin_date` date NOT NULL COMMENT '打卡日期',
  `checked_in` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否已签到: 0未签到 1已签到',
  `study_seconds` int NOT NULL DEFAULT 0 COMMENT '当天学习时长(秒)',
  `segments_completed` int NOT NULL DEFAULT 0 COMMENT '当天完成片段数',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_date`(`user_id` ASC, `checkin_date` ASC) USING BTREE COMMENT '防止重复打卡',
  INDEX `idx_user_id`(`user_id` ASC) USING BTREE,
  INDEX `idx_checkin_date`(`checkin_date` ASC) USING BTREE,
  CONSTRAINT `fk_checkin_log_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 16 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户打卡记录表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for user_checkin_stats
-- ----------------------------
DROP TABLE IF EXISTS `user_checkin_stats`;
CREATE TABLE `user_checkin_stats`  (
  `user_id` int NOT NULL COMMENT '用户ID',
  `total_checkin_days` int NOT NULL DEFAULT 0 COMMENT '总打卡天数',
  `last_checkin_time` datetime NULL DEFAULT NULL COMMENT '上次打卡时间',
  `current_streak_days` int NOT NULL DEFAULT 0 COMMENT '当前连续天数',
  `max_streak_days` int NOT NULL DEFAULT 0 COMMENT '最大连续天数',
  `total_study_seconds` int NOT NULL DEFAULT 0 COMMENT '累计学习时长(秒)',
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`) USING BTREE,
  CONSTRAINT `fk_checkin_stats_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户打卡统计表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for user_fav_segment
-- ----------------------------
DROP TABLE IF EXISTS `user_fav_segment`;
CREATE TABLE `user_fav_segment`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `segment_id` int NOT NULL COMMENT '收藏的片段ID',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_segment`(`user_id` ASC, `segment_id` ASC) USING BTREE,
  INDEX `segment_id`(`segment_id` ASC) USING BTREE,
  CONSTRAINT `user_fav_segment_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `user_fav_segment_ibfk_2` FOREIGN KEY (`segment_id`) REFERENCES `segment` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 11 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user_fav_word
-- ----------------------------
DROP TABLE IF EXISTS `user_fav_word`;
CREATE TABLE `user_fav_word`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `vocabulary_id` int NOT NULL COMMENT '收藏的单词ID',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_vocab`(`user_id` ASC, `vocabulary_id` ASC) USING BTREE,
  INDEX `vocabulary_id`(`vocabulary_id` ASC) USING BTREE,
  CONSTRAINT `user_fav_word_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `user_fav_word_ibfk_2` FOREIGN KEY (`vocabulary_id`) REFERENCES `vocabulary` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 10 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user_progress
-- ----------------------------
DROP TABLE IF EXISTS `user_progress`;
CREATE TABLE `user_progress`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '用户ID',
  `segment_id` int NOT NULL COMMENT '片段ID',
  `phase1_done` tinyint(1) NOT NULL DEFAULT 0 COMMENT '阶段一盲听是否完成',
  `phase2_done` tinyint(1) NOT NULL DEFAULT 0 COMMENT '阶段二学习是否完成',
  `phase3_done` tinyint(1) NOT NULL DEFAULT 0 COMMENT '阶段三配音是否完成',
  `phase3_score` decimal(5, 2) NULL DEFAULT NULL COMMENT '阶段三最高分',
  `phase4_done` tinyint(1) NOT NULL DEFAULT 0 COMMENT '阶段四影子跟读是否完成',
  `phase4_score` decimal(5, 2) NULL DEFAULT NULL COMMENT '阶段四最高分',
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_segment`(`user_id` ASC, `segment_id` ASC) USING BTREE,
  INDEX `segment_id`(`segment_id` ASC) USING BTREE,
  CONSTRAINT `user_progress_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `user_progress_ibfk_2` FOREIGN KEY (`segment_id`) REFERENCES `segment` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 16 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for vocabulary
-- ----------------------------
DROP TABLE IF EXISTS `vocabulary`;
CREATE TABLE `vocabulary`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `segment_id` int NOT NULL COMMENT '所属片段',
  `word` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '英文原词',
  `forms` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '词形变化，逗号分隔，如 shadows,shadowed,shadowing',
  `phonetic` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '音标，如 /ˈʃædoʊ/',
  `meaning` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '中文释义',
  `exampleSentence` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '英文例句',
  `exampleTranslation` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '例句中文翻译',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '在片段中的出现顺序',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `media_id` int NULL DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `segment_id`(`segment_id` ASC) USING BTREE,
  CONSTRAINT `vocabulary_ibfk_1` FOREIGN KEY (`segment_id`) REFERENCES `segment` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 178 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for word_bank
-- ----------------------------
DROP TABLE IF EXISTS `word_bank`;
CREATE TABLE `word_bank`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `word` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '英文原词',
  `phonetic` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '音标，如 /ˈʃædoʊ/',
  `meaning` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '中文释义',
  `forms` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '词形变化，逗号分隔',
  `exampleSentence` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '英文例句',
  `exampleTranslation` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '例句中文翻译',
  `level` int NOT NULL COMMENT '难度: 1小学 2初中 3高中 4四级 5六级',
  `source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '来源，如人教版小学三年级上册',
  `frequency` int NOT NULL DEFAULT 0 COMMENT '词频/优先级，数字越大越常用',
  `tags` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '标签，如名词,动物,基础',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `media_id` int NULL DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_word_level`(`word` ASC, `level` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 191 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci ROW_FORMAT = DYNAMIC;

-- migrations 表由 migrate.ts 的 ensureMigrationsTable() 统一创建（单一数据源），
-- 此处不再重复建表，避免与版本记录表冲突。

SET FOREIGN_KEY_CHECKS = 1;
