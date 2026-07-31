-- 030_guest_fingerprint.sql
-- 游客二期：录音等写端点改用浏览器指纹替代 guest_token cookie 识别游客身份。
--
-- 设计要点：
-- 1. fingerprint_hash：浏览器指纹 SHA-256 哈希（64 位十六进制），UNIQUE 索引保证同一指纹只对应一行
-- 2. 与 guest_key 共存：guest_key 用于一期学习时长（cookie 通道），fingerprint_hash 用于二期录音等（header 通道）
-- 3. ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id) 收敛并发双请求到同一行（复刻 guest_key 模式）

ALTER TABLE `user`
  ADD COLUMN `fingerprint_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL DEFAULT NULL
    COMMENT '浏览器指纹SHA-256（游客行非空，UNIQUE）' AFTER `merged_into_user_id`,
  ADD UNIQUE INDEX `uk_fingerprint`(`fingerprint_hash`);
