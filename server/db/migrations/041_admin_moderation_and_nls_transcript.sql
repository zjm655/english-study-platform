-- 041_admin_moderation_and_nls_transcript.sql
-- 管理员上传 DeepSeek 审核开关 + NLS 转写落库
--
-- 背景：
-- 1) 管理员上传此前未对主文本做 DeepSeek 审核，仅免费正则以对话检测兜底，SRT 字幕/中文等混入。
--    新增 sys_config 开关 admin_moderation_enabled（默认开）控制管理员主文本 DeepSeek 审核。
-- 2) NLS 识别结果原仅临时用于审核与相似度，未落库；新增 nls_transcript 列持久化，供审计/前端查看/重处理复用。
-- 幂等：ADD COLUMN 随版本只执行一次；seed 用 ON DUPLICATE KEY 不覆盖管理员已调整值。

ALTER TABLE `material_upload_record`
  ADD COLUMN `nls_transcript` text CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL COMMENT 'NLS 语音识别转写文本（开启 NLS 且识别成功后写入，供审计/前端查看/重处理复用）';

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('admin_moderation_enabled', '1', '管理员上传材料 DeepSeek 内容审核开关（1=开启，默认开；0=关闭则跳过主文本审核）')
ON DUPLICATE KEY UPDATE config_value = config_value;