-- 033_upload_audio_persist_and_deepseek_timeout.sql
-- 上传音频持久化 + DeepSeek 超时后台可配
--
-- 1) material_upload_record.audio_oss_key：上传音频持久化
--    背景：用户/管理员上传的音频 Buffer 仅在内存，任务失败后重处理只读文本信息、丢失原音频，
--          processAdminMaterial 静默改走 TTS 合成，替换了上传的音频。
--    新增列记录同步段上传到 OSS 的对象键，重处理时据此下载复用原音频。
ALTER TABLE material_upload_record
  ADD COLUMN audio_oss_key varchar(1024) NULL COMMENT '上传音频的OSS对象键（NULL=无音频走TTS合成；失败重处理时据此复用原音频）' AFTER voice;

-- 2) DeepSeek 超时配置 seed（管理端 sys_config 可调）
--    背景：aiContent.ts 原硬编码内容生成 30s / 标题生成 10s，长文本经常超时。
--    默认内容生成 120s、标题生成 60s。ON DUPLICATE KEY 保持幂等且不覆盖管理员已调整的值。
INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('deepseek_timeout_ms', '120000', 'DeepSeek 学习内容生成超时（毫秒，默认120s）'),
  ('deepseek_title_timeout_ms', '60000', 'DeepSeek 标题生成超时（毫秒，默认60s）')
ON DUPLICATE KEY UPDATE config_value = config_value;
