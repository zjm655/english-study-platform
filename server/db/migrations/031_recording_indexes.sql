-- 031_recording_indexes.sql
-- 为 recording 表补充复合索引（注意：recording 表时间列名为 createdAt 驼峰）
-- 1. idx_user_phase_created：评测限流按 (user_id, phase, createdAt) 统计当日成功评测数（sargable 范围查询）
-- 2. idx_user_seg_phase_created：录音历史列表按 (user_id, segment_id, phase, createdAt) 分页查询
ALTER TABLE recording
  ADD INDEX idx_user_phase_created (user_id, phase, createdAt),
  ADD INDEX idx_user_seg_phase_created (user_id, segment_id, phase, createdAt);
