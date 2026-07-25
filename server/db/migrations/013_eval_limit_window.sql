-- 013_eval_limit_window.sql
-- 评测额度窗口化：新增时间窗口配置 + recording 复合索引

INSERT INTO sys_config (config_key, config_value, description)
VALUES ('eval_limit_window', '86400', '评测额度时间窗口（秒），默认86400即1天')
ON DUPLICATE KEY UPDATE config_value = config_value;

UPDATE sys_config SET description = '评测额度窗口内最大次数（管理员不受限），0表示不限制'
WHERE config_key = 'daily_eval_limit';

ALTER TABLE recording
  ADD INDEX idx_recording_user_window (user_id, createdAt, analyze_status, deleted_at);
