-- 029_guest_phase2.sql
-- 游客二期：新增 sys_config 配置项
--
-- 设计要点：
-- 1. guest_daily_audio_limit：游客每日音频下载次数限制（含播放签名 URL）
-- 2. guest_daily_eval_limit：游客每日评测次数限制，配音/影子跟读各自独立计数
-- 3. guest_retention_days：过期游客数据保留天数，超期由定时任务清理
-- 4. ON DUPLICATE KEY UPDATE 保证幂等，可重复执行

INSERT INTO sys_config (config_key, config_value, description) VALUES
  ('guest_daily_audio_limit', '20', '游客每日音频下载次数限制'),
  ('guest_daily_eval_limit', '1', '游客每日评测次数限制（配音/影子跟读各自独立计数）'),
  ('guest_retention_days', '180', '过期游客数据保留天数')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
