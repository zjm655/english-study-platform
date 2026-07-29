-- 014_eval_auth_log.sql
-- 评测鉴权发放日志：记录每次成功发放 warrantId 的评测授权，作为每日额度的计数依据。
--
-- 背景：此前额度按 recording.analyze_status='success' 计数，但 warrantId 由客户端 SDK 消费、
-- analyze 结果回写由客户端控制——用户不回写即计数不增长，daily_eval_limit 形同虚设、云费用可被刷。
-- 改为对服务端侧「授权发放次数」计数（真正的成本驱动点），堵死绕过。
-- 无外键约束：高写入旁路表避免锁开销；user_id 仅为统计维度。

CREATE TABLE `eval_auth_log` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '发放授权的用户ID',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发放时间',
  PRIMARY KEY (`id`),
  INDEX `idx_user_created` (`user_id`, `createdAt`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '评测鉴权发放日志';
