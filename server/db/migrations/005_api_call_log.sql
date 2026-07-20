-- ----------------------------
-- 运营统计：API 调用埋点日志表
-- ----------------------------

-- 全量记录 /api 请求（路径/方法/状态码/耗时/用户/IP），供管理后台聚合分析。
-- 无外键约束：高写入表避免锁开销；user_id 仅为统计维度，不做引用完整性。
-- 数据保留策略：建议定期清理 90 天前数据
-- DELETE FROM api_call_log WHERE createdAt < DATE_SUB(NOW(), INTERVAL 90 DAY);

CREATE TABLE `api_call_log` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `path` varchar(200) NOT NULL COMMENT 'API路径',
  `method` varchar(10) NOT NULL COMMENT 'HTTP方法',
  `status_code` smallint NOT NULL DEFAULT 200 COMMENT 'HTTP响应状态码',
  `duration_ms` int NOT NULL DEFAULT 0 COMMENT '请求耗时毫秒',
  `user_id` int NULL DEFAULT NULL COMMENT '调用者用户ID未登录为NULL',
  `ip` varchar(45) NULL DEFAULT NULL COMMENT '客户端IP兼容IPv6',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`createdAt`),
  INDEX `idx_path_created` (`path`, `createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'API调用埋点日志';
