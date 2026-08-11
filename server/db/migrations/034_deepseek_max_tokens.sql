-- 034_deepseek_max_tokens.sql
-- DeepSeek max_tokens 后台可配
--
-- 背景：DeepSeek 偶发输出截断与 max_tokens 相关，管理端 sys_config 可调。
-- 默认内容生成 4000、标题 200。ON DUPLICATE KEY 保持幂等且不覆盖管理员已调整的值。
INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('deepseek_max_tokens', '4000', 'DeepSeek 学习内容生成最大输出token（默认4000）'),
  ('deepseek_title_max_tokens', '200', 'DeepSeek 标题生成最大输出token（默认200）')
ON DUPLICATE KEY UPDATE config_value = config_value;
