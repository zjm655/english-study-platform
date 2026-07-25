-- 017_oss_playback_daily.sql
-- OSS 前端播放（外网下行）按天汇总表。
-- 背景：浏览器经签名 URL 直连 OSS 播放会产生外网下行流量，这是 OSS 唯一实际计费项
-- （上传流入内外网免费、内网流出免费、仅外网流出收费），但该请求绕过本服务，
-- api_call_log / cloud_service_call_log 均无从记录。前端在音频加载时 fire-and-forget
-- 上报，服务端按天累加计数（UPSERT），供 cloudEstimate 估算外网下行成本。
--
-- 设计为「每天一行」的有界汇总表（主键 stat_date）：天然有界、无需清理策略；
-- 只存聚合计数、不存播放明细（成本用途只需按天总量，明细无价值且会无界增长）。

CREATE TABLE `oss_playback_daily` (
  `stat_date` date NOT NULL COMMENT '统计日期 (按天聚合, 一天一行)',
  `play_count` int UNSIGNED NOT NULL DEFAULT 0 COMMENT '当日 OSS 外网播放次数 (前端签名 URL 直连播放)',
  PRIMARY KEY (`stat_date`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = 'OSS 前端播放外网下行按天汇总';
