-- 036_log_cloud_request_id.sql
-- 云服务埋点与上传任务增加请求短 ID（request_id），打通「用户请求 ↔ 上传任务 ↔ 云服务调用」关联：
-- - cloud_service_call_log.request_id：云调用归属到触发它的 8 位 requestId（与 api_call_log 同列互查），
--   任务流水线（runMaterialJob / processAdminMaterial）内经请求上下文（AsyncLocalStorage）自动填充，
--   非请求上下文（启动/定时/后台任务）为 NULL。
-- - cloud_service_call_log_archive.request_id：归档表镜像源表（仅保留 idx_created_at，不加索引）。
-- - material_upload_record.request_id：任务行记录触发请求的 requestId，管理端可直接按任务查云埋点。
-- 三列全部 NULL 默认，历史数据不回填。

ALTER TABLE `cloud_service_call_log`
  ADD COLUMN `request_id` varchar(32) NULL DEFAULT NULL COMMENT '请求短ID用于关联 api_call_log 与文件日志' AFTER `operation`,
  ADD INDEX `idx_request_id` (`request_id`);

ALTER TABLE `cloud_service_call_log_archive`
  ADD COLUMN `request_id` varchar(32) NULL DEFAULT NULL COMMENT '请求短ID（镜像源表）' AFTER `operation`;

ALTER TABLE `material_upload_record`
  ADD COLUMN `request_id` varchar(32) NULL DEFAULT NULL COMMENT '触发请求短ID（关联 api_call_log 与云服务埋点）' AFTER `status`;
