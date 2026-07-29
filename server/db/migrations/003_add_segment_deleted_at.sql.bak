-- ----------------------------
-- segment 表新增软删除字段
-- ----------------------------

-- 管理员删除材料采用软删除：deleted_at 为 NULL 表示未删除，非 NULL 表示已删除时间。
-- 字段命名与 user_progress / recording 表既有的 deleted_at 模式保持一致。
-- 用户侧所有查询 segment 的接口需追加 deleted_at IS NULL 过滤（管理员接口负责写入该字段）。

ALTER TABLE `segment`
  ADD COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间' AFTER `is_public`;
