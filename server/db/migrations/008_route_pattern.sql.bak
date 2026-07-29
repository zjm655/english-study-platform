-- 008_route_pattern.sql
-- api_call_log 增加 route_pattern 字段，用于 cloudEstimate 精确匹配动态路由
ALTER TABLE api_call_log ADD COLUMN route_pattern VARCHAR(200) DEFAULT NULL COMMENT '路由模式（如 /api/recording/:id/analyze）' AFTER path;