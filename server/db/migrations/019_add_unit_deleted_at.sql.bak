-- ----------------------------
-- unit 表新增软删除字段
-- ----------------------------

-- 管理员删除单元采用软删除：deleted_at 为 NULL 表示未删除，非 NULL 表示删除时间。
-- segment.unit_id 外键为 ON DELETE CASCADE，物理删除会级联删光单元下材料及其
-- user_progress / recording，因此单元删除只允许软删除（服务端不提供物理删除端点）。
-- 用户侧入口型查询（units 列表 / unit progress）需追加 deleted_at IS NULL 过滤；
-- 展示型 JOIN（历史进度 / 录音记录取单元标题）不过滤，软删保留行天然零回归。
-- 不建索引：unit 表行数极小且该列选择性低，与 segment.deleted_at 先例一致。
-- 注意：id=0 是「用户自定义材料」系统保留单元（见 002 迁移），禁止删除与编辑。

ALTER TABLE `unit`
  ADD COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间' AFTER `cover_media_id`;
