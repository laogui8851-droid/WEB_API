import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TG_CREATE_TABLES_SQL } from './adminSchema';

let supabase: SupabaseClient;

export function initSupabase(url: string, serviceKey: string): SupabaseClient {
  supabase = createClient(url, serviceKey);
  return supabase;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase 未初始化，请先调用 initSupabase()');
  }
  return supabase;
}

// 需要在 Supabase SQL Editor 中执行的建表 SQL
export const CREATE_TABLES_SQL = `
-- 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  room_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  ttl_seconds INTEGER NOT NULL,
  max_participants INTEGER NOT NULL DEFAULT 2,
  assigned_to BIGINT,
  note TEXT NOT NULL DEFAULT ''
);

ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE invite_codes ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at);

-- 启用 RLS（行级安全）
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- 允许 service_role 完全访问
CREATE POLICY "service_role_all" ON invite_codes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 健康状态表（Vercel 无服务器模式用）
CREATE TABLE IF NOT EXISTS health_state (
  id TEXT PRIMARY KEY,
  healthy BOOLEAN NOT NULL DEFAULT true,
  active_primary BOOLEAN NOT NULL DEFAULT true,
  last_checked TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE health_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON health_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

${TG_CREATE_TABLES_SQL}
`;
