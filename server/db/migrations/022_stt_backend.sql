-- 022_stt_backend.sql
-- STT 双后端：标准版录音文件识别（filetrans，免费试用每日 2h）优先 + 极速版（FlashRecognizer）自动回退。
--
-- 1) cloud_service_call_log 加业务时长列：filetrans 无额度查询 API，
--    「今日已用分钟」只能本地口径自算（按天 SUM biz_duration_ms，走 idx_service_created）。
--    不复用 token 三列——trend/导出页已按 DeepSeek token 语义聚合，避免口径污染。
ALTER TABLE `cloud_service_call_log`
  ADD COLUMN `biz_duration_ms` INT UNSIGNED DEFAULT NULL COMMENT '业务时长毫秒（nls=音频时长 BizDuration，区别于 duration_ms 执行耗时）' AFTER `total_tokens`;

-- 2) STT 运营配置（PUT 白名单 = key 存在于 sys_config，种子即注册）
--    stt_trial_start_date 用 '-' 占位（PUT 校验 value 非空），前端解析非日期视为未填
INSERT INTO sys_config (config_key, config_value, description)
VALUES
  ('stt_backend', 'filetrans', 'STT 后端: filetrans=标准版(免费试用每日120分钟,异步) flash=极速版(商用按量,同步)；filetrans 额度尽/试用到期/并发超限/下载失败/超时自动回退 flash'),
  ('stt_trial_start_date', '-', 'NLS 标准版免费试用开通日期(YYYY-MM-DD,试用期3个月)，用于监控页到期倒计时；- 表示未设置')
ON DUPLICATE KEY UPDATE config_value = config_value;
