-- 035_admin_operation_log_target_type.sql
-- 放宽 admin_operation_log / admin_operation_log_archive 的 target_type 列宽
--
-- 背景：材料操作（批量重处理/删除/单条删除）写入 target_type='material_upload_record'（21 字符），
-- 超出原 varchar(20) 导致 ER_DATA_TOO_LONG。
-- 归档表由 026 迁移静态创建（logArchive.ts 不动态建表），同步放宽列宽保证归档
-- INSERT ... SELECT 迁入时不报错；迁移逐文件执行，新库先建表（026）后放宽（035）顺序天然正确。
ALTER TABLE `admin_operation_log`
  MODIFY `target_type` varchar(50) NOT NULL COMMENT '操作对象类型: user/segment/unit/notice/sys_config/material_upload_record';

ALTER TABLE `admin_operation_log_archive`
  MODIFY `target_type` varchar(50) NOT NULL COMMENT '操作对象类型';
