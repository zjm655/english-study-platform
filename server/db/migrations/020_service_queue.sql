-- 020_service_queue.sql
-- 云服务并发队列配置（serviceQueue.ts 读取，管理端 config 页可调，5min TTL 缓存 + PUT 即时失效）
-- 取值约定：0 = 不限流（队列直通）；正整数 = 该云产品的最大并发数
-- 默认值为保守估计，请在各云产品控制台核实实际并发配额后经管理端调整

INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('queue_tts_concurrency', '4', 'Edge TTS 最大并发（0=不限流；与原 mapWithConcurrency(4) 持平）'),
  ('queue_nls_concurrency', '2', '阿里云 NLS 语音识别最大并发（0=不限流；试用版配额通常为 2）'),
  ('queue_deepseek_concurrency', '3', 'DeepSeek API 最大并发（0=不限流；含内容审核/生成/标题三类调用）'),
  ('queue_upload_concurrency', '2', '材料上传流水线最大并行任务数（0=不限流；每任务驻留约 5MB 内存）')
ON DUPLICATE KEY UPDATE config_value = config_value;

-- material_upload_record.status 增加 queued 语义（varchar(20) 无需改类型，仅更新注释）
ALTER TABLE material_upload_record
  MODIFY COLUMN `status` varchar(20) NOT NULL DEFAULT 'processing' COMMENT '处理状态: queued=排队中 processing=处理中 success=成功 failed=失败';
