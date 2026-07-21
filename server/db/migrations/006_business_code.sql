-- ----------------------------
-- 运营统计：api_call_log 增加业务错误码字段
-- 背景：validateError 返回 HTTP 200 + body.code != 0，
-- 原 status_code 口径无法区分业务错误，故新增 business_code 字段。
-- ----------------------------

ALTER TABLE `api_call_log`
  ADD COLUMN `business_code` SMALLINT NULL DEFAULT NULL
  COMMENT '业务错误码（从响应 body.code 提取，非 200 即为业务错误）'
  AFTER `status_code`;