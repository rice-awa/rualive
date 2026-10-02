CREATE TABLE IF NOT EXISTS uptimeflare (
    key VARCHAR(255) PRIMARY KEY,
    value BLOB NOT NULL
);

-- 「似了喵？」设备监控（PRD §6）
-- 每设备一行，心跳 UPSERT，读多写少
CREATE TABLE IF NOT EXISTS device_status (
  device_id   TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  os          TEXT,
  last_seen   INTEGER NOT NULL,   -- 服务端 Unix 秒
  last_title  TEXT,
  last_app    TEXT,
  last_idle   INTEGER DEFAULT 0
);

-- 原始采样，仅保留 14 天（cron 清理）；仅 usageTracking=true 的设备写入
CREATE TABLE IF NOT EXISTS device_events (
  device_id TEXT NOT NULL,
  ts        INTEGER NOT NULL,     -- 服务端 Unix 秒
  app       TEXT,
  title     TEXT,
  idle      INTEGER DEFAULT 0,
  PRIMARY KEY (device_id, ts)
);

-- 清理（DELETE WHERE ts < ?）与按时间范围的聚合走这个索引。
-- 主键 (device_id, ts) 的前导列是 device_id，服务不了纯 ts 范围条件 —— 缺这个索引会退化成
-- 每次全表扫描，D1 rows read 会被打满（详见 worker/src/index.ts 的清理注释）。
CREATE INDEX IF NOT EXISTS idx_device_events_ts ON device_events(ts);

-- 每日使用聚合（长期统计，永不清理）；仅 usageTracking=true 的设备写入
CREATE TABLE IF NOT EXISTS usage_daily (
  device_id TEXT NOT NULL,
  date      TEXT NOT NULL,        -- 'YYYY-MM-DD'，按配置时区切日
  app       TEXT NOT NULL,
  duration  INTEGER NOT NULL,     -- 累计秒数
  PRIMARY KEY (device_id, date, app)
);

-- M3 通知去重用：每设备一行，记最近一次通知时状态（-1 离线 / 1 在线）
CREATE TABLE IF NOT EXISTS device_notify_state (
  device_id   TEXT PRIMARY KEY,
  last_online INTEGER NOT NULL
);
