-- 038_log_p2.sql
-- P2 日志监控完善：评测失败原因落点 + 云健康/孤儿清理配置键。
-- 1) recording.analyze_error：评测失败原因（SDK 结构化上报，analyze-fail 扩展 body 后写入），
--    与 analyze_status='failed' 共存，管理端详情可查。
-- 2) sys_config 四键：
--    - cloud_health_window_min / cloud_health_fail_threshold_pct / cloud_health_min_failures：
--      云失败率骤升检测（06.cloudHealthMonitor）的窗口/阈值/最少失败数；
--    - orphan_audio_retention_days：失败记录音频保留天数（07.orphanAudioCleanup 超期清理，默认 7 天）。
--    注：alert_event.source 为 varchar 无 CHECK 约束，新增 'security' 值（loginAttempts 埋点）无需迁移。

ALTER TABLE `recording`
  ADD COLUMN `analyze_error` varchar(500) NULL DEFAULT NULL COMMENT '评测失败原因（SDK结构化上报，截断500）' AFTER `analyze_status`;

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('cloud_health_window_min', '5', '云失败率骤升检测窗口（分钟，1-60）'),
  ('cloud_health_fail_threshold_pct', '50', '云失败率骤升阈值（窗口内失败率%，1-100）'),
  ('cloud_health_min_failures', '5', '云失败率骤升最少失败条数（防低频误报，1-1000）'),
  ('orphan_audio_retention_days', '7', '失败记录音频保留天数（超期未重处理则清理孤儿对象，1-365）')
ON DUPLICATE KEY UPDATE config_value = config_value;
