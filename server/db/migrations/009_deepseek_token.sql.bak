-- 009_deepseek_token.sql
-- cloud_service_call_log 增加 DeepSeek token 用量字段
ALTER TABLE cloud_service_call_log
  ADD COLUMN prompt_tokens INT UNSIGNED DEFAULT NULL COMMENT '输入 token 数' AFTER duration_ms,
  ADD COLUMN completion_tokens INT UNSIGNED DEFAULT NULL COMMENT '输出 token 数' AFTER prompt_tokens,
  ADD COLUMN total_tokens INT UNSIGNED DEFAULT NULL COMMENT '总 token 数' AFTER completion_tokens;