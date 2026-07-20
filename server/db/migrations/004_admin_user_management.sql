-- ----------------------------
-- 管理员用户管理：user 状态字段 + 操作日志表
-- ----------------------------

-- 封禁（status=0）与销号（deleted_at 软删除）均保留数据、可恢复。
-- 硬删除（清 OSS + 清关联表）延后：recording/user_fav_segment/user_fav_word/user_progress
-- 的 user_id 外键为 RESTRICT，直接 DELETE user 会被阻断。

ALTER TABLE `user`
  ADD COLUMN `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '状态: 0封禁 1正常' AFTER `role`,
  ADD COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间(销号)' AFTER `status`;

-- 管理员操作日志：记录敏感操作（封禁/销号/改资料/材料编辑删除），便于追溯。
-- admin_id 用 ON DELETE SET NULL：管理员账号删除后日志仍保留（admin_id 置空）。
CREATE TABLE `admin_operation_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int NULL COMMENT '操作者(管理员)用户ID，账号删除后为 NULL',
  `action` varchar(50) NOT NULL COMMENT '操作类型: user.ban/user.unban/user.delete/user.update/segment.update/segment.delete',
  `target_type` varchar(20) NOT NULL COMMENT '操作对象类型: user/segment',
  `target_id` int NOT NULL COMMENT '操作对象ID',
  `detail` json NULL COMMENT '操作详情(变更前后关键字段快照)',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_admin` (`admin_id`),
  INDEX `idx_action` (`action`),
  INDEX `idx_created` (`createdAt`),
  CONSTRAINT `fk_admin_log_user` FOREIGN KEY (`admin_id`) REFERENCES `user` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '管理员操作日志';
