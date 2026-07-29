-- 012_upload_rate_limit.sql
-- sys_config 表新增上传材料限流独立配置（开关 + 次数 + 窗口）
-- 与全局限流开关独立：即便 rate_limit_enabled=0，上传路径仍受 rate_limit_upload_enabled 控制

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('rate_limit_upload_enabled', '1', '上传材料限流开关（1开/0关），独立于全局限流开关'),
  ('rate_limit_upload_max', '10', '上传材料限流窗口内最大请求数'),
  ('rate_limit_upload_window', '60', '上传材料限流窗口秒数')
ON DUPLICATE KEY UPDATE config_value = config_value;
