-- ----------------------------
-- 日志归档表（三张，镜像原表列结构）
-- ----------------------------
-- 背景：管理端「日志清理」原为分批物理 DELETE，历史数据不可恢复。
-- 本迁移为 api_call_log / cloud_service_call_log / admin_operation_log 各建一张
-- 同构归档表，清理改为「INSERT ... SELECT 迁入归档表 + 原表 DELETE」（logs/clean），
-- 归档表支持 CSV 导出（logs/export 白名单）与超期彻底删除（logs/archive-purge）。
--
-- 设计要点：
-- 1. 主键沿用原表 id（不设 AUTO_INCREMENT）：天然去重，重复归档幂等（INSERT IGNORE）。
-- 2. 不带外键：归档是历史快照，不做引用完整性（admin_id 为普通列）。
-- 3. 仅保留 idx_created_at：导出与超期删除均按 createdAt 过滤；归档表写多读少，
--    不复刻原表其余索引，避免无谓写放大。
-- 4. archived_at 记录迁入时刻，便于追溯归档批次。

CREATE TABLE `api_call_log_archive` (
  `id` bigint UNSIGNED NOT NULL,
  `path` varchar(200) NOT NULL COMMENT 'API路径',
  `route_pattern` varchar(200) NULL DEFAULT NULL COMMENT '路由模式（如 /api/recording/:id/analyze）',
  `method` varchar(10) NOT NULL COMMENT 'HTTP方法',
  `status_code` smallint NOT NULL DEFAULT 200 COMMENT 'HTTP响应状态码',
  `business_code` smallint NULL DEFAULT NULL COMMENT '业务错误码（从响应 body.code 提取）',
  `duration_ms` int NOT NULL DEFAULT 0 COMMENT '请求耗时毫秒',
  `user_id` int NULL DEFAULT NULL COMMENT '调用者用户ID未登录为NULL',
  `ip` varchar(45) NULL DEFAULT NULL COMMENT '客户端IP兼容IPv6',
  `request_id` varchar(32) NULL DEFAULT NULL COMMENT '请求短ID用于关联文件日志',
  `error_message` varchar(500) NULL DEFAULT NULL COMMENT '错误信息（截断500字符）',
  `error_stack` text NULL COMMENT '错误堆栈（仅5xx记录截断4000字符）',
  `createdAt` datetime NOT NULL COMMENT '原始日志时间',
  `archived_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档迁入时间',
  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = 'API调用日志归档表，由 logs/clean 迁入';

CREATE TABLE `cloud_service_call_log_archive` (
  `id` bigint UNSIGNED NOT NULL,
  `service` varchar(20) NOT NULL COMMENT '云服务标识: deepseek, tts, oss, nls, bss',
  `operation` varchar(50) NOT NULL COMMENT '操作名称',
  `success` tinyint(1) NOT NULL DEFAULT 1 COMMENT '调用是否成功',
  `duration_ms` int NOT NULL DEFAULT 0 COMMENT '调用耗时毫秒',
  `prompt_tokens` int UNSIGNED NULL DEFAULT NULL COMMENT '输入 token 数',
  `completion_tokens` int UNSIGNED NULL DEFAULT NULL COMMENT '输出 token 数',
  `total_tokens` int UNSIGNED NULL DEFAULT NULL COMMENT '总 token 数',
  `biz_duration_ms` int UNSIGNED NULL DEFAULT NULL COMMENT '业务时长毫秒（nls=音频时长 BizDuration）',
  `error_message` varchar(500) NULL DEFAULT NULL COMMENT '失败时的错误信息',
  `createdAt` datetime NOT NULL COMMENT '原始日志时间',
  `archived_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档迁入时间',
  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '云服务调用日志归档表，由 logs/clean 迁入';

CREATE TABLE `admin_operation_log_archive` (
  `id` int NOT NULL,
  `admin_id` int NULL COMMENT '操作者(管理员)用户ID，账号删除后为 NULL',
  `action` varchar(50) NOT NULL COMMENT '操作类型',
  `target_type` varchar(20) NOT NULL COMMENT '操作对象类型',
  `target_id` int NOT NULL COMMENT '操作对象ID',
  `detail` json NULL COMMENT '操作详情(变更前后关键字段快照)',
  `createdAt` datetime NOT NULL COMMENT '原始日志时间',
  `archived_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档迁入时间',
  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '管理员操作日志归档表，由 logs/clean 迁入';
