-- 027_guest_identity.sql
-- 访客（游客）身份模块一期：复用 user 表承载游客身份。
--
-- 设计要点（见 .agents/docs/2026-07-31-guest-identity-phase1.md）：
-- 1. 游客行 is_guest=1、account/passwordHash 置 NULL（故此二列由 NOT NULL 改 NULL；
--    唯一索引对多个 NULL 兼容，游客不占账号空间）。
-- 2. guest_key：游客 JWT 对应的随机键，UNIQUE——懒实体化用 ON DUPLICATE KEY 收敛并发，
--    登录合并按此键定位游客行。
-- 3. merged_into_user_id：合并去向，兼作幂等 latch（合并事务内置位，非空即已合并）与溯源。
-- 4. 新用户注册=同行转正（is_guest 置 0 + 填账号密码）；老用户登录=跨行合并后软删游客行。

ALTER TABLE `user`
  MODIFY `account` varchar(20) CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL,
  MODIFY `passwordHash` varchar(255) CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL,
  ADD COLUMN `is_guest` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否游客: 0正式 1游客' AFTER `role`,
  ADD COLUMN `guest_key` varchar(36) CHARACTER SET utf8mb4 COLLATE ${COLLATION} NULL DEFAULT NULL COMMENT '游客JWT随机键' AFTER `is_guest`,
  ADD COLUMN `merged_into_user_id` int NULL DEFAULT NULL COMMENT '游客行已合并去向(latch+溯源)' AFTER `guest_key`,
  ADD UNIQUE INDEX `uk_guest_key`(`guest_key`);

-- 游客单日学习时长上限（秒），默认 14400=4h，运营可调；防真 cookie 脚本刷时长
INSERT INTO sys_config (config_key, config_value, description)
VALUES ('guest_daily_study_cap', '14400', '游客单日学习时长上限（秒），防刷')
ON DUPLICATE KEY UPDATE config_value = config_value;
