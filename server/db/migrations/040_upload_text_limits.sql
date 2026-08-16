-- 040_upload_text_limits.sql
-- 上传材料文本长度限制运营可调：原代码硬编码（zod schema 10~5000 / admin handler 10~5000 / aiContent 输入上限 5000）
-- 抽入 sys_config，管理员与普通用户分档（对齐音频时长/大小双档模式）
-- 注：aiContent 的输入上限读取管理员档（upload_max_text_admin），不单独设键
-- ON DUPLICATE KEY 保持幂等且不覆盖管理员已调整的值

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('upload_min_text_user', '10', '普通用户材料文本最少字符数'),
  ('upload_max_text_user', '5000', '普通用户材料文本最多字符数'),
  ('upload_min_text_admin', '10', '管理员材料文本最少字符数（单条与批量 txt 共用）'),
  ('upload_max_text_admin', '5000', '管理员材料文本最多字符数（单条与批量 txt 共用；同时作为 AI 内容生成输入上限）')
ON DUPLICATE KEY UPDATE config_value = config_value;
