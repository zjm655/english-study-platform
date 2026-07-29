-- 023_api_call_log_error_diag.sql
-- 为 api_call_log 增加错误诊断字段与 requestId，并补 (status_code, createdAt) 索引。
-- 背景：管理面板 API 调用日志只有状态码，无法直接定位错误原因；
-- 新增 request_id 与文件日志（logs/api）打通实现 DB↔文件双向定位，
-- error_message/error_stack 记录 error 钩子捕获的诊断信息（message 截断 500，
-- stack 仅 5xx 记录并截断 4000，登录/注册/验证码路径不记 stack 防参数泄漏）。
-- 三列全部 NULL 默认，历史数据不回填。
-- 单条 ALTER 语句执行，避免多语句 DDL 失败时部分生效。

ALTER TABLE `api_call_log`
  ADD COLUMN `request_id` varchar(32) NULL DEFAULT NULL COMMENT '请求短ID用于关联文件日志' AFTER `ip`,
  ADD COLUMN `error_message` varchar(500) NULL DEFAULT NULL COMMENT '错误信息（截断500字符）' AFTER `request_id`,
  ADD COLUMN `error_stack` text NULL COMMENT '错误堆栈（仅5xx记录截断4000字符）' AFTER `error_message`,
  ADD INDEX `idx_status_created` (`status_code`, `createdAt`);
