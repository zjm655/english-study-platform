-- 037_alert_event_and_log_archive_config.sql
-- 1) 统一告警事件表 alert_event：P1 可观测性事件落库（E 前端错误上报 / 埋点队列丢弃 / 任务失败），
--    为未来告警通道预留单一数据源（本期不建任何通知通道）。
--    - source 枚举：client_error（前端错误）/ log_queue（埋点队列丢弃）/ task_fail（任务失败）/
--      cloud_health（云服务健康事件，二期接入，枚举预留）
--    - context JSON 存结构化上下文（堆栈截断/队列名/任务 recordId 等），不落敏感字段（账号密码等）
--    - 量级小（前端错误 + 任务失败 + 丢弃事件），本期不进 ARCHIVABLE_TABLES 归档体系；
--      保留策略（purge/归档）在告警通道立项时一并设计
-- 2) sys_config 三键：自动归档开关/间隔/保留阈值（管理端「系统配置」页可调；ON DUPLICATE KEY 幂等
--    且不覆盖管理员已调整的值，先例 034）。

CREATE TABLE `alert_event` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `source` varchar(20) NOT NULL COMMENT '事件来源: client_error/log_queue/task_fail/cloud_health',
  `level` varchar(10) NOT NULL DEFAULT 'error' COMMENT '级别: error/warn',
  `code` varchar(50) NULL DEFAULT NULL COMMENT '事件码: client_js_error/client_unhandledrejection/log_queue_dropped/task_fail 等',
  `message` varchar(500) NULL DEFAULT NULL COMMENT '事件概要（截断500）',
  `request_id` varchar(32) NULL DEFAULT NULL COMMENT '请求短ID（与 api_call_log/cloud_service_call_log 互查）',
  `user_id` int NULL DEFAULT NULL COMMENT '关联用户ID（未登录为NULL）',
  `context` json NULL COMMENT '结构化上下文（堆栈截断/队列名/任务ID等）',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_source_created` (`source`, `createdAt`),
  INDEX `idx_level_created` (`level`, `createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '告警事件表（可观测性事件数据源，告警通道立项后消费）';

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('log_archive_auto_enabled', '1', '日志自动归档总开关（1开/0关，关闭后手动归档按钮仍可用）'),
  ('log_archive_auto_interval_days', '1', '自动归档执行间隔天数（每隔N天执行一次，1-365）'),
  ('log_archive_retention_days', '30', '自动归档保留阈值（迁走超过N天前的日志，7-3650）'),
  ('client_error_report_enabled', '1', '前端错误上报总开关（1开/0关，浏览器JS错误上报服务端）')
ON DUPLICATE KEY UPDATE config_value = config_value;
