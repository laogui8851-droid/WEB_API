import { InviteService } from './tokenService';
import {
  PaymentOrder,
  addBotCodes,
  expirePendingPaymentOrders,
  findPaymentOrderByTxHash,
  getPendingPaymentOrders,
  getSetting,
  markPaymentOrderPaid,
} from './adminStore';
import { readIntEnv } from './env';

type Trc20Transfer = {
  txHash: string;
  amount: number;
  timestamp: number;
};

const DEFAULT_PAYMENT_CODE_TTL_SECONDS = 12 * 60 * 60;
const POLL_INTERVAL_MS = readIntEnv('PAYMENT_POLL_INTERVAL_MS', 30000);
const TRON_USDT_CONTRACT =
  process.env.TRON_USDT_CONTRACT?.trim() || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const TRON_GRID_API_KEY = process.env.TRON_GRID_API_KEY?.trim() || '';

let polling = false;

function normalizeWalletAddress(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/T[1-9A-HJ-NP-Za-km-z]{33}/);
  return match ? match[0] : null;
}

function isSameAmount(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

async function fetchIncomingUsdtTransfers(address: string, minTimestamp: number): Promise<Trc20Transfer[]> {
  const url = new URL(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`);
  url.searchParams.set('only_to', 'true');
  url.searchParams.set('limit', '200');
  url.searchParams.set('min_timestamp', String(minTimestamp));
  url.searchParams.set('order_by', 'block_timestamp,desc');
  url.searchParams.set('contract_address', TRON_USDT_CONTRACT);

  const headers: Record<string, string> = {};
  if (TRON_GRID_API_KEY) {
    headers['TRON-PRO-API-KEY'] = TRON_GRID_API_KEY;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TRON API 请求失败: ${response.status}`);
  }

  const payload = (await response.json()) as { data?: Array<any> };
  const items = Array.isArray(payload.data) ? payload.data : [];
  return items
    .map((item) => ({
      txHash: String(item.transaction_id || ''),
      amount: Number(item.value || 0) / 1_000_000,
      timestamp: Number(item.block_timestamp || 0),
    }))
    .filter((item) => item.txHash && Number.isFinite(item.amount) && item.timestamp > 0);
}

async function handlePaidOrder(order: PaymentOrder, txHash: string, inviteService: InviteService) {
  const created = await inviteService.createCodes(order.quantity, DEFAULT_PAYMENT_CODE_TTL_SECONDS, 2);
  const codes = created.map((item) => item.code);

  if (codes.length !== order.quantity) {
    throw new Error(`订单 ${order.id} 发码失败，期望 ${order.quantity}，实际 ${codes.length}`);
  }

  const added = await addBotCodes(order.bot_id, codes, order.telegram_id);
  if (!added) {
    throw new Error(`订单 ${order.id} 写入授权码失败`);
  }

  const marked = await markPaymentOrderPaid(order.id, txHash);
  if (!marked) {
    throw new Error(`订单 ${order.id} 标记支付成功失败`);
  }
}

export async function pollPaymentOrders(inviteService: InviteService): Promise<{ matched: number; paid: number }> {
  if (polling) {
    return { matched: 0, paid: 0 };
  }

  polling = true;

  try {
    await expirePendingPaymentOrders();
    const wallet = normalizeWalletAddress(await getSetting('payment_address'));
    if (!wallet) {
      return { matched: 0, paid: 0 };
    }

    const pendingOrders = await getPendingPaymentOrders();
    if (pendingOrders.length === 0) {
      return { matched: 0, paid: 0 };
    }

    const earliest = Math.min(...pendingOrders.map((item) => new Date(item.created_at).getTime())) - 60_000;
    const transfers = await fetchIncomingUsdtTransfers(wallet, Math.max(0, earliest));
    if (transfers.length === 0) {
      return { matched: 0, paid: 0 };
    }

    let matched = 0;
    let paid = 0;

    for (const order of pendingOrders) {
      const match = transfers.find((tx) => {
        if (!isSameAmount(tx.amount, Number(order.payable_amount))) {
          return false;
        }
        const createdAt = new Date(order.created_at).getTime() - 60_000;
        const expireAt = new Date(order.expire_at).getTime();
        return tx.timestamp >= createdAt && tx.timestamp <= expireAt;
      });

      if (!match) {
        continue;
      }

      matched += 1;
      const processed = await findPaymentOrderByTxHash(match.txHash);
      if (processed) {
        continue;
      }

      await handlePaidOrder(order, match.txHash, inviteService);
      paid += 1;
    }

    return { matched, paid };
  } finally {
    polling = false;
  }
}

export function startPaymentMonitor(inviteService: InviteService) {
  void pollPaymentOrders(inviteService).catch((error) => {
    console.error('支付监听初始化失败:', error);
  });

  return setInterval(() => {
    void pollPaymentOrders(inviteService).catch((error) => {
      console.error('支付监听轮询失败:', error);
    });
  }, POLL_INTERVAL_MS);
}