export const TG_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tg_admins (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_sale_bots (
  id SERIAL PRIMARY KEY,
  bot_token TEXT NOT NULL UNIQUE,
  bot_username TEXT,
  bot_name TEXT,
  added_by BIGINT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS tg_packages (
  id SERIAL PRIMARY KEY,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_payment_orders (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  bot_id INTEGER REFERENCES tg_sale_bots(id) ON DELETE CASCADE,
  package_id INTEGER REFERENCES tg_packages(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(18,6) NOT NULL,
  total_price DECIMAL(18,6) NOT NULL,
  amount_offset DECIMAL(18,6) NOT NULL,
  payable_amount DECIMAL(18,6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expire_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tg_user_codes (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  bot_id INTEGER REFERENCES tg_sale_bots(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  used BOOLEAN DEFAULT false,
  room_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tg_bot_bindings (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER NOT NULL REFERENCES tg_sale_bots(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bot_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS tg_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tg_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_sale_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_user_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_bot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all" ON tg_admins;
DROP POLICY IF EXISTS "service_all" ON tg_sale_bots;
DROP POLICY IF EXISTS "service_all" ON tg_packages;
DROP POLICY IF EXISTS "service_all" ON tg_payment_orders;
DROP POLICY IF EXISTS "service_all" ON tg_user_codes;
DROP POLICY IF EXISTS "service_all" ON tg_bot_bindings;
DROP POLICY IF EXISTS "service_all" ON tg_settings;

CREATE POLICY "service_all" ON tg_admins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_sale_bots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_packages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_payment_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_user_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_bot_bindings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON tg_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO tg_settings (key, value) VALUES
  ('payment_address', 'TRC20: 待设置'),
  ('payment_backup', ''),
  ('api_url', ''),
  ('api_url_main', ''),
  ('api_url_backup', ''),
  ('usage_instructions', '📖 平台使用说明\n\n1️⃣ 购买后授权码会进入当前分组\n2️⃣ 授权码从第一次进入会议开始计时，有效时间 12 小时\n3️⃣ 授权码一码一房间，会议结束后可再次开设房间'),
  ('customer_service', '@yunjihuiyi_support'),
  ('news_content', '📰 云际会议资讯\n\n暂无最新资讯'),
  ('web_url', 'https://www.example.com'),
  ('download_url', 'https://www.example.com'),
  ('purchase_notice', '📦 购买须知\n\n1️⃣ 购买成功后，授权码会自动入库\n2️⃣ 授权码从第一次进入会议开始计时\n3️⃣ 授权码一码一房间，会议结束后可再次开设房间')
ON CONFLICT (key) DO NOTHING;
`;