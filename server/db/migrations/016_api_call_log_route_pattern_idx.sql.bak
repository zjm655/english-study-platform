-- 016_api_call_log_route_pattern_idx.sql
-- 为 api_call_log 增加 (route_pattern, method, createdAt) 复合索引。
-- 背景：008 补了 route_pattern 列但未建索引；cloudEstimate 成本估算与 edu 用量趋势
-- 均按 route_pattern + method + 时间范围聚合，005 仅有 idx_created_at/idx_path_created，
-- 该过滤为残余扫描，随埋点数据增长退化为近全表扫描，故补此索引走覆盖过滤。

ALTER TABLE api_call_log
  ADD INDEX idx_route_created (route_pattern, method, createdAt);
