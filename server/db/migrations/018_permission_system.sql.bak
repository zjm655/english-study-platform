-- ----------------------------
-- 审核管理员权限系统：细粒度权限表 + 审核访问留痕表
-- ----------------------------

-- 专用权限表：权限键授予制（超管隐式全权，不在此表落行）。
-- 复合主键 (user_id, permission_key) 一索双用：点查「某用户有无键K」+ 前缀扫「列出某用户全部键」。
-- granted_by 记录授予者(超管)，ON DELETE SET NULL 保留历史；user_id 外键 CASCADE 随用户销号清理。
CREATE TABLE `user_permission` (
  `user_id` int NOT NULL COMMENT '被授权用户ID',
  `permission_key` varchar(50) NOT NULL COMMENT '权限键 详见 shared/utils/permission.ts',
  `granted_by` int NULL COMMENT '授予者(超管)用户ID 账号删除后为 NULL',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `permission_key`),
  INDEX `idx_perm` (`permission_key`),
  CONSTRAINT `fk_user_perm_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_perm_granter` FOREIGN KEY (`granted_by`) REFERENCES `user` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户细粒度权限授予表';

-- 审核访问留痕：查看非公开用户材料/配音时同步写入(写成功才签名)。镜像 admin_operation_log。
-- operator_id ON DELETE SET NULL：操作者账号删除后留痕仍保留(operator_id 置空)。
CREATE TABLE `review_access_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `operator_id` int NULL COMMENT '访问者用户ID 账号删除后为 NULL',
  `operator_role` tinyint NOT NULL COMMENT '访问者角色快照 0用户 1管理员 2超管',
  `target_type` varchar(20) NOT NULL COMMENT '对象类型 material_record/segment',
  `target_id` int NOT NULL COMMENT '对象ID',
  `target_user_id` int NULL COMMENT '被查看材料的归属用户ID',
  `reason_category` varchar(30) NOT NULL COMMENT '理由类别',
  `reason` varchar(500) NOT NULL COMMENT '详细理由',
  `ip` varchar(64) NULL COMMENT '访问者IP',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_operator` (`operator_id`),
  INDEX `idx_target` (`target_type`, `target_id`),
  INDEX `idx_created` (`createdAt`),
  CONSTRAINT `fk_review_log_user` FOREIGN KEY (`operator_id`) REFERENCES `user` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '审核访问留痕';

-- 存量平滑：升首位活跃管理员为超级管理员(唯一授权者)，确保上线即有可用超管。
UPDATE `user` SET `role` = 2 WHERE `role` = 1 AND `deleted_at` IS NULL ORDER BY `id` ASC LIMIT 1;

-- 回填其余存量管理员默认权限(不含 review/grant_permissions)，保持其现有行为不变、避免上线即失权。
-- 上一句已把首位管理员升为 role=2，故此处 role=1 天然排除超管。
INSERT INTO `user_permission` (`user_id`, `permission_key`) SELECT `id`, 'manage_materials' FROM `user` WHERE `role` = 1;
INSERT INTO `user_permission` (`user_id`, `permission_key`) SELECT `id`, 'manage_users' FROM `user` WHERE `role` = 1;
INSERT INTO `user_permission` (`user_id`, `permission_key`) SELECT `id`, 'view_stats' FROM `user` WHERE `role` = 1;
INSERT INTO `user_permission` (`user_id`, `permission_key`) SELECT `id`, 'view_logs' FROM `user` WHERE `role` = 1;
INSERT INTO `user_permission` (`user_id`, `permission_key`) SELECT `id`, 'config' FROM `user` WHERE `role` = 1;
