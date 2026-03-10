const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_KEY');
const appConfigApiUrl = requireEnv('APP_CONFIG_API_URL');
const appConfigApiKey = requireEnv('APP_CONFIG_API_KEY');

const sb = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  // 尝试直接 upsert（如果表存在）
  const { data, error } = await sb.from('app_config').upsert([
    { key: 'api_url', value: appConfigApiUrl },
    { key: 'api_key', value: appConfigApiKey }
  ]);

  if (error) {
    console.log('app_config 表不存在，请先在 Supabase SQL Editor 执行以下 SQL：');
    console.log('');
    console.log(`CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_anon_read" ON app_config FOR SELECT TO anon USING (true);
INSERT INTO app_config (key, value) VALUES ('api_url', '${appConfigApiUrl}');
INSERT INTO app_config (key, value) VALUES ('api_key', '${appConfigApiKey}');`);
    console.log('');
    console.log('错误详情:', error.message);
  } else {
    console.log('配置写入成功！');
    // 验证
    const { data: d2, error: e2 } = await sb.from('app_config').select('*');
    if (e2) console.log('读取错误:', e2.message);
    else console.log('当前配置:', JSON.stringify(d2, null, 2));
  }
}

main().catch(console.error);
