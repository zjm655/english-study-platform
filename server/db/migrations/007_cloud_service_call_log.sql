-- ----------------------------
-- 云服务调用埋点日志表
-- ----------------------------
-- 记录所有第三方云服务调用（DeepSeek / Edge TTS / OSS / NLS / BSS），
-- 解决 api_call_log 无法追踪非 HTTP 调用（WebSocket / pop-core SDK）的问题，
-- 替代 cloudEstimate.ts 中基于 HTTP 端点数的代理估算。
--
-- 无外键约束：高写入表避免锁开销。
-- 数据保留策略：建议定期清理 90 天前数据。
-- DELETE FROM cloud_service_call_log WHERE createdAt < DATE_SUB(NOW(), INTERVAL 90 DAY);

CREATE TABLE `cloud_service_call_log` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `service` varchar(20) NOT NULL COMMENT '云服务标识: deepseek, tts, oss, nls, bss',
  `operation` varchar(50) NOT NULL COMMENT '操作名称',
  `success` tinyint(1) NOT NULL DEFAULT 1 COMMENT '调用是否成功',
  `duration_ms` int NOT NULL DEFAULT 0 COMMENT '调用耗时毫秒',
  `error_message` varchar(500) NULL DEFAULT NULL COMMENT '失败时的错误信息',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_service_created` (`service`, `createdAt`),
  INDEX `idx_created_at` (`createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '云服务调用埋点日志';