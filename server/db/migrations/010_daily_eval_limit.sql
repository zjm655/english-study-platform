-- 010_daily_eval_limit.sql
-- 系统配置表：存储全局可配置参数（如每日评测次数上限）

CREATE TABLE IF NOT EXISTS sys_config (
  config_key VARCHAR(50) NOT NULL PRIMARY KEY COMMENT '配置键',
  config_value VARCHAR(255) NOT NULL COMMENT '配置值',
  description VARCHAR(200) DEFAULT NULL COMMENT '配置说明',
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION} COMMENT='系统配置表';

-- 默认：普通用户每日评测次数上限 20 次
INSERT INTO sys_config (config_key, config_value, description)
VALUES ('daily_eval_limit', '20', '普通用户每日评测次数上限（管理员不受限）')
ON DUPLICATE KEY UPDATE config_value = config_value;
