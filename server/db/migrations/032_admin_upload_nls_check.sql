-- 032_admin_upload_nls_check.sql
-- 管理员上传材料可选 NLS 语音校对（消耗 NLS 每日免费额度/按量费用）：
--
-- 1) material_upload_record.nls_check：上传任务维度标记（重处理 reprocess 时沿用，标记不丢失）
ALTER TABLE material_upload_record
  ADD COLUMN nls_check tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否开启 NLS 语音校对: 0关闭 1开启（管理员上传音频时可选）' AFTER is_public;

-- 2) segment.nls_check：材料维度标记（材料管理列表/详情展示「已启用 NLS 校验」）
ALTER TABLE segment
  ADD COLUMN nls_check tinyint(1) NOT NULL DEFAULT 0 COMMENT '材料是否经 NLS 语音校对: 0否 1是' AFTER is_public;
