-- 024_upload_limits.sql
-- 上传限制运营可调：原代码硬编码常量（时长/大小/录音上限/队列深度）抽入 sys_config
-- ON DUPLICATE KEY 保持幂等且不覆盖管理员已调整的值

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('upload_max_duration_user', '180', '普通用户上传/录制音频最大时长（秒）'),
  ('upload_max_duration_admin', '600', '管理员上传/录制音频最大时长（秒）'),
  ('upload_max_size_user', '2097152', '普通用户音频最大字节数（默认2MB）'),
  ('upload_max_size_admin', '5242880', '管理员音频最大字节数（默认5MB）'),
  ('upload_recording_max_size', '52428800', '录音上传文件大小上限（字节，默认50MB）'),
  ('upload_queue_max', '50', '上传队列待处理深度上限')
ON DUPLICATE KEY UPDATE config_value = config_value;
