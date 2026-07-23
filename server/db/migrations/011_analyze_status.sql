-- 011_analyze_status.sql
-- recording 表新增 analyze_status 列（分析状态）+ sys_config 限流开关配置

-- 1. recording 表新增 analyze_status 列（放在 score 列之后）
ALTER TABLE `recording`
  ADD COLUMN `analyze_status` VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT '分析状态: pending/failed/success' AFTER `score`;

-- 2. 回填存量数据：已有 score 的记录视为成功
UPDATE `recording` SET `analyze_status` = 'success' WHERE `score` IS NOT NULL;

-- 3. sys_config 表插入限流开关配置（仿 010 迁移风格）
INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('rate_limit_enabled', '1', '限流总开关（1开/0关）'),
  ('rate_limit_ip_level', '1', 'IP 级限流开关（1开/0关）'),
  ('rate_limit_user_level', '1', '用户级限流开关（1开/0关）')
ON DUPLICATE KEY UPDATE config_value = config_value;
