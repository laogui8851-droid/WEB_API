import crypto from 'crypto';
import { getSupabase } from './database';

export interface AdminRecord {
  telegram_id: number;
  username: string | null;
}

export interface SaleBot {
  id: number;
  bot_token: string;
  bot_username: string | null;
  bot_name: string | null;
  added_by: number | null;
  active: boolean;
}

export interface PackageRecord {
  id: number;
  quantity: number;
  unit_price: number;
}

export interface PaymentOrder {
  id: number;
  telegram_id: number;
  bot_id: number;
  package_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  amount_offset: number;
  payable_amount: number;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  tx_hash: string | null;
  created_at: string;
  expire_at: string;
  paid_at: string | null;
}

export interface UserCode {
  id: number;
  telegram_id: number;
  bot_id: number;
  code: string;
  used: boolean;
  room_name: string | null;
  created_at: string;
}

export interface BotBinding {
  id: number;
  bot_id: number;
  telegram_id: number;
  created_at: string;
}

export interface BotCodeStats {
  botId: number;
  botName: string;
  total: number;
  used: number;
  unused: number;
  expired: number;
}

export interface CodeDetail {
  code: string;
  room_name: string | null;
  activated_at: string | null;
  expires_at: string | null;
  ttl_seconds: number;
  created_at: string;
  status: 'unused' | 'in_use' | 'expired';
  remaining_seconds: number | null;
}

export function buildDisabledBotToken(): string {
  return `disabled:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  const { data } = await getSupabase()
    .from('tg_admins')
    .select('id')
    .eq('telegram_id', telegramId)
    .single();
  return !!data;
}

export async function addAdmin(telegramId: number, username?: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_admins')
    .upsert({ telegram_id: telegramId, username }, { onConflict: 'telegram_id' });
  return !error;
}

export async function removeAdmin(telegramId: number): Promise<boolean> {
  const { error } = await getSupabase().from('tg_admins').delete().eq('telegram_id', telegramId);
  return !error;
}

export async function getAdmins(): Promise<AdminRecord[]> {
  const { data } = await getSupabase().from('tg_admins').select('telegram_id, username');
  return (data as AdminRecord[]) || [];
}

export async function initAdmins(adminIds: number[]): Promise<void> {
  for (const adminId of adminIds) {
    const exists = await isAdmin(adminId);
    if (!exists) {
      await addAdmin(adminId);
    }
  }
}

export async function addSaleBot(
  botToken: string,
  botUsername: string | null,
  botName: string,
  addedBy: number | null,
): Promise<boolean> {
  const { error } = await getSupabase().from('tg_sale_bots').insert({
    bot_token: botToken,
    bot_username: botUsername,
    bot_name: botName,
    added_by: addedBy,
  });
  return !error;
}

export async function removeSaleBot(id: number): Promise<boolean> {
  const { error } = await getSupabase().from('tg_sale_bots').delete().eq('id', id);
  return !error;
}

export async function getSaleBots(): Promise<SaleBot[]> {
  const { data, error } = await getSupabase()
    .from('tg_sale_bots')
    .select('*')
    .eq('active', true)
    .order('id', { ascending: true });
  if (error) {
    throw error;
  }
  return (data as SaleBot[]) || [];
}

export async function getSaleBotById(id: number): Promise<SaleBot | null> {
  const { data } = await getSupabase().from('tg_sale_bots').select('*').eq('id', id).single();
  return (data as SaleBot) || null;
}

export async function addPackage(quantity: number, unitPrice: number): Promise<boolean> {
  const { error } = await getSupabase().from('tg_packages').insert({
    quantity,
    unit_price: unitPrice,
  });
  return !error;
}

export async function removePackage(id: number): Promise<boolean> {
  const { error } = await getSupabase().from('tg_packages').delete().eq('id', id);
  return !error;
}

export async function getPackages(): Promise<PackageRecord[]> {
  const { data } = await getSupabase()
    .from('tg_packages')
    .select('*')
    .order('quantity', { ascending: true });
  return (data as PackageRecord[]) || [];
}

export async function createPaymentOrder(input: {
  telegramId: number;
  botId: number;
  packageId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  amountOffset: number;
  payableAmount: number;
  expireAt: string;
}): Promise<PaymentOrder | null> {
  const { data, error } = await getSupabase()
    .from('tg_payment_orders')
    .insert({
      telegram_id: input.telegramId,
      bot_id: input.botId,
      package_id: input.packageId,
      quantity: input.quantity,
      unit_price: input.unitPrice,
      total_price: input.totalPrice,
      amount_offset: input.amountOffset,
      payable_amount: input.payableAmount,
      expire_at: input.expireAt,
    })
    .select('*')
    .single();
  if (error) {
    return null;
  }
  return (data as PaymentOrder) || null;
}

export async function getPendingPaymentOrders(): Promise<PaymentOrder[]> {
  const now = new Date().toISOString();
  const { data } = await getSupabase()
    .from('tg_payment_orders')
    .select('*')
    .eq('status', 'pending')
    .gt('expire_at', now)
    .order('created_at', { ascending: true });
  return (data as PaymentOrder[]) || [];
}

export async function listPaymentOrders(status?: PaymentOrder['status']): Promise<PaymentOrder[]> {
  let query = getSupabase().from('tg_payment_orders').select('*').order('created_at', { ascending: false });
  if (status) {
    query = query.eq('status', status);
  }
  const { data } = await query;
  return (data as PaymentOrder[]) || [];
}

export async function getRecentPendingOrdersByTotal(totalPrice: number): Promise<PaymentOrder[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await getSupabase()
    .from('tg_payment_orders')
    .select('*')
    .eq('status', 'pending')
    .eq('total_price', totalPrice)
    .gte('created_at', since);
  return (data as PaymentOrder[]) || [];
}

export async function findPaymentOrderByTxHash(txHash: string): Promise<PaymentOrder | null> {
  const { data } = await getSupabase()
    .from('tg_payment_orders')
    .select('*')
    .eq('tx_hash', txHash)
    .single();
  return (data as PaymentOrder) || null;
}

export async function markPaymentOrderPaid(orderId: number, txHash: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_payment_orders')
    .update({
      status: 'paid',
      tx_hash: txHash,
      paid_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'pending');
  return !error;
}

export async function markPaymentOrderFailed(orderId: number): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_payment_orders')
    .update({ status: 'failed' })
    .eq('id', orderId)
    .eq('status', 'pending');
  return !error;
}

export async function expirePendingPaymentOrders(): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_payment_orders')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expire_at', new Date().toISOString());
  return !error;
}

export async function addUserCodes(telegramId: number, botId: number, codes: string[]): Promise<boolean> {
  const rows = codes.map((code) => ({
    telegram_id: telegramId,
    bot_id: botId,
    code,
  }));
  const { error } = await getSupabase().from('tg_user_codes').insert(rows);
  return !error;
}

export async function addBotCodes(botId: number, codes: string[], telegramId = 0): Promise<boolean> {
  return addUserCodes(telegramId, botId, codes);
}

export async function getBotCodes(botId: number, used?: boolean): Promise<UserCode[]> {
  let query = getSupabase()
    .from('tg_user_codes')
    .select('*')
    .eq('bot_id', botId)
    .order('created_at', { ascending: false });
  if (used !== undefined) {
    query = query.eq('used', used);
  }
  const { data } = await query;
  return (data as UserCode[]) || [];
}

export async function markCodeUsed(code: string, roomName?: string): Promise<boolean> {
  const update: { used: boolean; room_name?: string } = { used: true };
  if (roomName) {
    update.room_name = roomName;
  }
  const { error } = await getSupabase().from('tg_user_codes').update(update).eq('code', code);
  return !error;
}

export async function markCodeUnused(code: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_user_codes')
    .update({ used: false, room_name: null })
    .eq('code', code);
  return !error;
}

export async function deleteUserCode(code: string): Promise<boolean> {
  const { error } = await getSupabase().from('tg_user_codes').delete().eq('code', code);
  return !error;
}

export async function deleteAllBotCodes(botId: number): Promise<number> {
  const { data } = await getSupabase().from('tg_user_codes').select('code').eq('bot_id', botId);
  if (!data || data.length === 0) {
    return 0;
  }
  const { error } = await getSupabase().from('tg_user_codes').delete().eq('bot_id', botId);
  return error ? 0 : data.length;
}

export async function getBotBindings(botId: number): Promise<BotBinding[]> {
  const { data } = await getSupabase()
    .from('tg_bot_bindings')
    .select('*')
    .eq('bot_id', botId)
    .order('created_at', { ascending: true });
  return (data as BotBinding[]) || [];
}

export async function isBotUserBound(botId: number, telegramId: number): Promise<boolean> {
  const { data } = await getSupabase()
    .from('tg_bot_bindings')
    .select('id')
    .eq('bot_id', botId)
    .eq('telegram_id', telegramId)
    .single();
  return !!data;
}

export async function bindBotUser(
  botId: number,
  telegramId: number,
): Promise<'bound' | 'exists' | 'full' | 'error'> {
  const exists = await isBotUserBound(botId, telegramId);
  if (exists) {
    return 'exists';
  }

  const bindings = await getBotBindings(botId);
  if (bindings.length >= 2) {
    return 'full';
  }

  const { error } = await getSupabase().from('tg_bot_bindings').insert({
    bot_id: botId,
    telegram_id: telegramId,
  });
  return error ? 'error' : 'bound';
}

export async function unbindBotUser(botId: number, telegramId: number): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_bot_bindings')
    .delete()
    .eq('bot_id', botId)
    .eq('telegram_id', telegramId);
  return !error;
}

export async function getAllCodesStatsByBot(): Promise<BotCodeStats[]> {
  const bots = await getSaleBots();
  const result: BotCodeStats[] = [];
  const now = Date.now();

  for (const bot of bots) {
    const codes = await getBotCodes(bot.id);
    const total = codes.length;

    if (total === 0) {
      result.push({
        botId: bot.id,
        botName: bot.bot_name || bot.bot_username || '未命名渠道',
        total: 0,
        used: 0,
        unused: 0,
        expired: 0,
      });
      continue;
    }

    const codeStrings = codes.map((item) => item.code.trim().toUpperCase());
    const { data: invites } = await getSupabase()
      .from('invite_codes')
      .select('code, room_name, activated_at, expires_at')
      .in('code', codeStrings);

    let used = 0;
    let expired = 0;

    if (invites && invites.length > 0) {
      const inviteMap = new Map(invites.map((item: any) => [item.code, item]));
      for (const code of codes) {
        const invite = inviteMap.get(code.code.trim().toUpperCase()) as any;
        if (!invite) {
          if (code.used) {
            used += 1;
          }
          continue;
        }

        const expiresAt = invite.expires_at ? new Date(invite.expires_at).getTime() : null;
        const isExpired = expiresAt !== null && expiresAt <= now;
        const isInUse = !!invite.room_name && !isExpired;
        if (isExpired) {
          expired += 1;
        } else if (isInUse || invite.activated_at) {
          used += 1;
        }
      }
    } else {
      used = codes.filter((item) => item.used).length;
    }

    result.push({
      botId: bot.id,
      botName: bot.bot_name || bot.bot_username || '未命名渠道',
      total,
      used,
      unused: total - used - expired,
      expired,
    });
  }

  return result;
}

export async function getBotCodesDetail(botId: number): Promise<CodeDetail[]> {
  const codes = await getBotCodes(botId);
  if (codes.length === 0) {
    return [];
  }

  const codeStrings = codes.map((item) => item.code.trim().toUpperCase());
  const { data: invites } = await getSupabase().from('invite_codes').select('*').in('code', codeStrings);

  const inviteMap = new Map((invites || []).map((item: any) => [item.code, item]));
  const now = Date.now();

  return codes.map((code) => {
    const invite = inviteMap.get(code.code.trim().toUpperCase()) as any;
    if (!invite) {
      return {
        code: code.code,
        room_name: code.room_name,
        activated_at: null,
        expires_at: null,
        ttl_seconds: 0,
        created_at: code.created_at,
        status: code.used ? 'in_use' : 'unused',
        remaining_seconds: null,
      } satisfies CodeDetail;
    }

    const expiresAt = invite.expires_at ? new Date(invite.expires_at).getTime() : null;
    const isExpired = expiresAt !== null && expiresAt <= now;
    const isInUse = !!invite.activated_at && !isExpired;

    return {
      code: code.code,
      room_name: invite.room_name,
      activated_at: invite.activated_at,
      expires_at: invite.expires_at,
      ttl_seconds: invite.ttl_seconds,
      created_at: invite.created_at,
      status: isExpired ? 'expired' : isInUse ? 'in_use' : 'unused',
      remaining_seconds: expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null,
    } satisfies CodeDetail;
  });
}

export async function getCodeDetail(code: string): Promise<CodeDetail | null> {
  const normalized = code.trim().toUpperCase();
  const { data } = await getSupabase().from('invite_codes').select('*').eq('code', normalized).maybeSingle();

  if (!data) {
    return null;
  }

  const now = Date.now();
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
  const isExpired = expiresAt !== null && expiresAt <= now;
  const isInUse = !!data.activated_at && !isExpired;

  return {
    code: data.code,
    room_name: data.room_name,
    activated_at: data.activated_at,
    expires_at: data.expires_at,
    ttl_seconds: data.ttl_seconds,
    created_at: data.created_at,
    status: isExpired ? 'expired' : isInUse ? 'in_use' : 'unused',
    remaining_seconds: expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null,
  };
}

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('tg_settings').select('value').eq('key', key).single();
  return data?.value || null;
}

export async function getAllSettings(): Promise<{ key: string; value: string }[]> {
  const { data } = await getSupabase().from('tg_settings').select('key, value').order('key', { ascending: true });
  return (data as { key: string; value: string }[]) || [];
}

export async function getSettingsByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
  const { data } = await getSupabase().from('tg_settings').select('key, value').like('key', `${prefix}%`);
  return ((data as { key: string; value: string }[]) || []).filter((item) => item.value);
}

export async function setSetting(key: string, value: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('tg_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return !error;
}

export async function setAppConfigValue(key: string, value: string): Promise<boolean> {
	const { error } = await getSupabase()
		.from('app_config')
		.upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
	return !error;
}

export async function deleteSetting(key: string): Promise<boolean> {
  const { error } = await getSupabase().from('tg_settings').delete().eq('key', key);
  return !error;
}

export async function allocatePayableAmount(baseTotal: number): Promise<{ offset: number; payable: number } | null> {
  const pending = await getRecentPendingOrdersByTotal(baseTotal);
  const used = new Set(pending.map((item) => Number(item.payable_amount).toFixed(3)));
  for (let step = 1; step <= 999; step += 1) {
    const offset = step / 1000;
    const payable = Number((baseTotal + offset).toFixed(3));
    if (!used.has(payable.toFixed(3))) {
      return { offset, payable };
    }
  }
  return null;
}

