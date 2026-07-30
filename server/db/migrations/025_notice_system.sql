-- 025_notice_system.sql
-- 系统公告模块：公告主表 + 用户已读回执表
-- 说明：状态三态 draft/published/revoked，无独立 scheduled 态。
--       「定时发布」= status 置为 published + publish_at 设为未来时刻，
--       活跃口径统一用 publish_at <= NOW() 判定是否真正对用户可见，
--       故到点自动生效、无需后台调度器改写状态。

-- ----------------------------
-- Table structure for notice（公告主表）
-- ----------------------------
CREATE TABLE IF NOT EXISTS `notice` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE ${COLLATION} NOT NULL COMMENT '公告标题',
  `content` text CHARACTER SET utf8mb4 COLLATE ${COLLATION} NOT NULL COMMENT '公告正文',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE ${COLLATION} NOT NULL DEFAULT 'draft' COMMENT '状态: draft草稿 published已发布 revoked已撤回 无scheduled态定时发布=published+未来publish_at',
  `publish_at` datetime NOT NULL COMMENT '发布时间 未来时刻=定时发布 默认取当前时间由应用层传入',
  `expire_at` datetime NULL DEFAULT NULL COMMENT '过期时间 NULL=永不过期',
  `is_pinned` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否置顶: 0否 1是',
  `created_by` int NOT NULL COMMENT '创建者(管理员)用户ID',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间 NULL未删除',
  PRIMARY KEY (`id`),
  INDEX `idx_status_publish` (`status`, `publish_at`),
  INDEX `idx_pinned_created` (`is_pinned` DESC, `createdAt` DESC),
  CONSTRAINT `fk_notice_creator` FOREIGN KEY (`created_by`) REFERENCES `user` (`id`) ON DELETE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '系统公告表';

-- ----------------------------
-- Table structure for notice_read（用户已读回执表）
-- ----------------------------
CREATE TABLE IF NOT EXISTS `notice_read` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT '读者用户ID',
  `notice_id` int NOT NULL COMMENT '公告ID',
  `read_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次已读时间',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_user_notice` (`user_id`, `notice_id`),
  INDEX `idx_notice` (`notice_id`),
  CONSTRAINT `fk_notice_read_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notice_read_notice` FOREIGN KEY (`notice_id`) REFERENCES `notice` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = ${COLLATION} COMMENT = '公告已读回执表';
