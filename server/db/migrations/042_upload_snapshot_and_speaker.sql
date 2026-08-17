-- 042_upload_snapshot_and_speaker.sql
-- 失败上传诊断：任务流水线快照 + 说话人标注
--
-- 1) pipeline_snapshot：材料上传流水线各阶段结果（文本审核/STT/NLS审核/说话人标注/TTS/AI/标题/失败点），
--    于失败或成功终端一次性写入 JSON，供诊断页回溯本次上传现场。
-- 2) speaker_annotated：DeepSeek 审核通过后对 NLS 对话文本自动标注说话人的结果（仅展示+人工「采用」回写正文）。
-- ADD COLUMN 随版本只执行一次。
ALTER TABLE `material_upload_record`
  ADD COLUMN `pipeline_snapshot` text CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL COMMENT '上传流水线各阶段结果快照(JSON)：stages/failedAt/finalError，诊断页回溯用',
  ADD COLUMN `speaker_annotated` text CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL COMMENT 'DeepSeek 对 NLS 对话文本的说话人标注结果（仅展示；管理员「采用」后回写 text_content）';