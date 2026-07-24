-- 015_api_call_log_user_index.sql
-- 为 api_call_log 增加 (user_id, createdAt) 复合索引。
-- 背景：GET /api/admin/user/[userId]/logs 按 user_id 过滤 + 分页，
-- 而 005 建表仅有 idx_created_at 与 idx_path_created，按用户维度查询会全表扫描。
-- 随全量埋点数据增长，该查询会显著退化，故补此索引。

ALTER TABLE api_call_log
  ADD INDEX idx_user_created (user_id, createdAt);
