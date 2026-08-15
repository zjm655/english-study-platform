-- 039_eval_auth_log_phase.sql
-- P3-B：游客评测额度改按「发放计数」（eval_auth_log），与登录侧同口径（014 迁移已修复登录侧，
-- 游客侧此前按客户端回写 analyze_status='success' 计数，换证不写回即额度不消耗、云费用可刷）。
-- eval_auth_log 增加 phase 列：游客发放时写入 3/4（配音/跟读），保持 guest_daily_eval_limit=1/阶段/日 语义；
-- 登录用户发放为 NULL（登录侧额度按窗口计数，不区分阶段）。

ALTER TABLE `eval_auth_log`
  ADD COLUMN `phase` tinyint NULL DEFAULT NULL COMMENT '评测阶段: 3=配音 4=跟读（游客发放写入，登录用户为 NULL）' AFTER `user_id`;
