-- 021_eval_gate.sql
-- 评测拒绝型闸门：限制全局同时进行的评测数（评测由前端 SDK 直连阿里云执行，
-- 服务端无法排队等待，只能在 warrantId 发放前拒绝——"让超出并发的用户抢空闲名额"）。
-- 活跃评测数用 eval_auth_log 近窗（默认 300s = warrantId 有效期）发放计数估算。

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('eval_gate_max', '20', '评测并发闸门：近窗口内最多发放的评测鉴权数（0=不限制），超出拒绝并提示稍后重试'),
  ('eval_gate_window', '300', '评测并发闸门估算窗口秒数（建议等于 warrantId 有效期 300s）')
ON DUPLICATE KEY UPDATE config_value = config_value;

-- eval_auth_log 现有索引前导列为 user_id，纯时间范围 COUNT 无法走索引，补单列时间索引
ALTER TABLE eval_auth_log ADD INDEX idx_created (createdAt);
