import { Request, RequestHandler, Response, Router } from 'express';
import { InviteService } from './tokenService';
import {
  addAdmin,
  addBotCodes,
  addPackage,
  addSaleBot,
  allocatePayableAmount,
  bindBotUser,
  buildDisabledBotToken,
  createPaymentOrder,
  deleteSetting,
  deleteUserCode,
  getAdmins,
  getAllCodesStatsByBot,
  getAllSettings,
  getBotBindings,
  getBotCodesDetail,
  getCodeDetail,
  getPackages,
  getSaleBotById,
  getSaleBots,
  getSetting,
  getSettingsByPrefix,
  initAdmins,
  listPaymentOrders,
  markCodeUnused,
  removeAdmin,
  removePackage,
  removeSaleBot,
  setAppConfigValue,
  setSetting,
  unbindBotUser,
} from './adminStore';
import { readIntEnv } from './env';
import { pollPaymentOrders } from './paymentMonitor';

const PAYMENT_ORDER_EXPIRE_MINUTES = readIntEnv('PAYMENT_ORDER_EXPIRE_MINUTES', 30);

type ApiUrlStatus = {
  key: string;
  url: string;
  healthy: boolean;
};

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function readCustomerId(req: Request): number | null {
  return parseInteger(req.body.customerId ?? req.body.telegramId);
}

function normalizeHttpUrl(value: string): string | null {
  const normalized = value.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(normalized)) {
    return null;
  }
  return normalized;
}

async function checkUrlHealth(url: string, manual = false): Promise<boolean> {
  try {
    const endpoint = manual ? '/api/health/check' : '/api/health';
    const response = await fetch(`${url}${endpoint}`, {
      method: manual ? 'POST' : 'GET',
      headers: manual ? { 'Content-Type': 'application/json' } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function registerBackofficeRoutes(
  router: Router,
  requireAdmin: RequestHandler,
  inviteService: InviteService,
) {
  router.get('/console/summary', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [admins, bots, packages, orders, settings, codeStats] = await Promise.all([
        getAdmins(),
        getSaleBots(),
        getPackages(),
        listPaymentOrders(),
        getAllSettings(),
        getAllCodesStatsByBot(),
      ]);

      res.json({
        ok: true,
        counts: {
          admins: admins.length,
          bots: bots.length,
          packages: packages.length,
          pendingOrders: orders.filter((item) => item.status === 'pending').length,
          paidOrders: orders.filter((item) => item.status === 'paid').length,
        },
        settings,
        codeStats,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/console/admins', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await getAdmins());
  });

  router.post('/console/admins', requireAdmin, async (req: Request, res: Response) => {
    const telegramId = parseInteger(req.body.telegramId);
    if (!telegramId) {
      res.status(400).json({ error: '缺少有效的 telegramId' });
      return;
    }

    const ok = await addAdmin(telegramId, typeof req.body.username === 'string' ? req.body.username.trim() : undefined);
    if (!ok) {
      res.status(500).json({ error: '添加管理员失败' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/console/admins/:telegramId', requireAdmin, async (req: Request, res: Response) => {
    const telegramId = parseInteger(req.params.telegramId);
    if (!telegramId) {
      res.status(400).json({ error: '缺少有效的 telegramId' });
      return;
    }
    res.json({ ok: await removeAdmin(telegramId) });
  });

  router.post('/console/admins/init', requireAdmin, async (req: Request, res: Response) => {
    const adminIds = Array.isArray(req.body.adminIds)
        ? req.body.adminIds
          .map((item: unknown) => parseInteger(item))
          .filter((item: number | null): item is number => item !== null)
      : [];
    await initAdmins(adminIds);
    res.json({ ok: true, initialized: adminIds.length });
  });

  router.get('/console/bots', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await getSaleBots());
  });

  router.post('/console/bots', requireAdmin, async (req: Request, res: Response) => {
    const botName = typeof req.body.botName === 'string' ? req.body.botName.trim() : '';
    const botUsername = typeof req.body.botUsername === 'string' ? req.body.botUsername.trim() : null;
    const addedBy = parseInteger(req.body.addedBy);
    const botToken = typeof req.body.botToken === 'string' && req.body.botToken.trim()
      ? req.body.botToken.trim()
      : buildDisabledBotToken();

    if (!botName) {
      res.status(400).json({ error: '缺少 botName' });
      return;
    }

    const ok = await addSaleBot(botToken, botUsername, botName, addedBy);
    if (!ok) {
      res.status(500).json({ error: '创建分组失败' });
      return;
    }

    res.json({ ok: true, disabledBotToken: !req.body.botToken });
  });

  router.delete('/console/bots/:id', requireAdmin, async (req: Request, res: Response) => {
    const id = parseInteger(req.params.id);
    if (!id) {
      res.status(400).json({ error: '缺少有效的 id' });
      return;
    }
    res.json({ ok: await removeSaleBot(id) });
  });

  router.get('/console/packages', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await getPackages());
  });

  router.post('/console/packages', requireAdmin, async (req: Request, res: Response) => {
    const quantity = parseInteger(req.body.quantity);
    const unitPrice = parsePositiveNumber(req.body.unitPrice);
    if (!quantity || !unitPrice) {
      res.status(400).json({ error: '缺少有效的 quantity 或 unitPrice' });
      return;
    }

    const ok = await addPackage(quantity, unitPrice);
    if (!ok) {
      res.status(500).json({ error: '创建套餐失败' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/console/packages/:id', requireAdmin, async (req: Request, res: Response) => {
    const id = parseInteger(req.params.id);
    if (!id) {
      res.status(400).json({ error: '缺少有效的 id' });
      return;
    }
    res.json({ ok: await removePackage(id) });
  });

  router.get('/console/settings', requireAdmin, async (_req: Request, res: Response) => {
    const [settings, backups] = await Promise.all([getAllSettings(), getSettingsByPrefix('api_url_backup')]);
    res.json({ settings, apiUrlBackups: backups });
  });

  router.get('/console/api-urls', requireAdmin, async (_req: Request, res: Response) => {
    const [currentUrlRaw, mainUrlRaw, backups] = await Promise.all([
      getSetting('api_url'),
      getSetting('api_url_main'),
      getSettingsByPrefix('api_url_backup'),
    ]);

    const currentUrl = normalizeHttpUrl(currentUrlRaw || '') || '';
    const mainUrl = normalizeHttpUrl(mainUrlRaw || '') || '';

    res.json({
      currentUrl,
      mainUrl,
      backups: backups
        .map((item) => ({ key: item.key, value: normalizeHttpUrl(item.value) || '' }))
        .filter((item) => item.value),
    });
  });

  router.put('/console/api-urls/main', requireAdmin, async (req: Request, res: Response) => {
    const url = normalizeHttpUrl(typeof req.body.url === 'string' ? req.body.url : '');
    const secret = typeof req.body.secret === 'string' ? req.body.secret.trim() : null;
    if (!url) {
      res.status(400).json({ error: '接口地址格式错误，请以 http:// 或 https:// 开头' });
      return;
    }

    let ok =
      (await setSetting('api_url_main', url)) &&
      (await setSetting('api_url', url)) &&
      (await setAppConfigValue('api_url', url));

    if (ok && secret !== null) {
		ok =
			(await setSetting('api_secret', secret)) &&
			(await setAppConfigValue('api_key', secret));
	}
    if (!ok) {
      res.status(500).json({ error: '保存主接口失败' });
      return;
    }

    res.json({ ok: true, currentUrl: url, mainUrl: url, hasSecret: secret !== null });
  });

  router.post('/console/api-urls/backups', requireAdmin, async (req: Request, res: Response) => {
    const url = normalizeHttpUrl(typeof req.body.url === 'string' ? req.body.url : '');
    if (!url) {
      res.status(400).json({ error: '接口地址格式错误，请以 http:// 或 https:// 开头' });
      return;
    }

    const existing = await getSettingsByPrefix('api_url_backup');
    const duplicated = existing.find((item) => (normalizeHttpUrl(item.value) || '') === url);
    if (duplicated) {
      res.status(409).json({ error: '该备用接口已存在' });
      return;
    }

    const nextKey = existing.length === 0 ? 'api_url_backup' : `api_url_backup_${existing.length + 1}`;
    const ok = await setSetting(nextKey, url);
    if (!ok) {
      res.status(500).json({ error: '添加备用接口失败' });
      return;
    }

    res.json({ ok: true, key: nextKey, url });
  });

  router.delete('/console/api-urls/backups/:key', requireAdmin, async (req: Request, res: Response) => {
    const key = readParam(req.params.key).trim();
    if (!key.startsWith('api_url_backup')) {
      res.status(400).json({ error: '只能删除备用接口配置' });
      return;
    }

    const ok = await deleteSetting(key);
    res.json({ ok });
  });

  router.post('/console/api-urls/health-check', requireAdmin, async (_req: Request, res: Response) => {
    const [currentUrlRaw, backups] = await Promise.all([
      getSetting('api_url'),
      getSettingsByPrefix('api_url_backup'),
    ]);

    const currentUrl = normalizeHttpUrl(currentUrlRaw || '');
    const currentHealthy = currentUrl ? await checkUrlHealth(currentUrl, true) : false;
    const backupResults: ApiUrlStatus[] = [];

    for (const item of backups) {
      const url = normalizeHttpUrl(item.value || '');
      if (!url) {
        continue;
      }
      const healthy = await checkUrlHealth(url, true);
      backupResults.push({ key: item.key, url, healthy });
    }

    let switchedTo: string | null = null;
    if (!currentHealthy) {
      const healthyBackup = backupResults.find((item) => item.healthy);
      if (healthyBackup) {
        const switched = await setSetting('api_url', healthyBackup.url);
        if (switched) {
          switchedTo = healthyBackup.url;
        }
      }
    }

    res.json({
      ok: true,
      current: {
        key: 'api_url',
        url: currentUrl || '',
        healthy: currentHealthy,
      },
      backups: backupResults,
      switchedTo,
    });
  });

  router.put('/console/settings/:key', requireAdmin, async (req: Request, res: Response) => {
    const key = readParam(req.params.key).trim();
    const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';
    if (!key) {
      res.status(400).json({ error: '缺少 key' });
      return;
    }
    if (!value) {
      res.status(400).json({ error: '缺少 value' });
      return;
    }

    const ok = await setSetting(key, value);
    if (!ok) {
      res.status(500).json({ error: '更新设置失败' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/console/settings/:key', requireAdmin, async (req: Request, res: Response) => {
    const key = readParam(req.params.key).trim();
    if (!key) {
      res.status(400).json({ error: '缺少 key' });
      return;
    }
    res.json({ ok: await deleteSetting(key) });
  });

  router.get('/console/orders', requireAdmin, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as string) : undefined;
    res.json(await listPaymentOrders(status as any));
  });

  router.post('/console/orders', requireAdmin, async (req: Request, res: Response) => {
    const customerId = readCustomerId(req);
    const botId = parseInteger(req.body.botId);
    const packageId = parseInteger(req.body.packageId);
    if (!customerId || !botId || !packageId) {
      res.status(400).json({ error: '缺少有效的 customerId、botId 或 packageId' });
      return;
    }

    const [bot, packages, paymentAddress, paymentBackup] = await Promise.all([
      getSaleBotById(botId),
      getPackages(),
      getSetting('payment_address'),
      getSetting('payment_backup'),
    ]);
    const pkg = packages.find((item) => item.id === packageId);

    if (!bot) {
      res.status(404).json({ error: '分组不存在' });
      return;
    }
    if (!pkg) {
      res.status(404).json({ error: '套餐不存在' });
      return;
    }
    if (!paymentAddress || paymentAddress.includes('待设置')) {
      res.status(400).json({ error: '收款地址未设置' });
      return;
    }

    const baseTotal = Number(pkg.quantity) * Number(pkg.unit_price);
    const amountPlan = await allocatePayableAmount(baseTotal);
    if (!amountPlan) {
      res.status(409).json({ error: '当前待支付订单过多，请稍后再试' });
      return;
    }

    const expireAt = new Date(Date.now() + PAYMENT_ORDER_EXPIRE_MINUTES * 60 * 1000).toISOString();
    const order = await createPaymentOrder({
      telegramId: customerId,
      botId,
      packageId,
      quantity: Number(pkg.quantity),
      unitPrice: Number(pkg.unit_price),
      totalPrice: baseTotal,
      amountOffset: amountPlan.offset,
      payableAmount: amountPlan.payable,
      expireAt,
    });

    if (!order) {
      res.status(500).json({ error: '创建订单失败' });
      return;
    }

    res.json({
      ok: true,
      order,
      payment: {
        address: paymentAddress,
        backupAddress: paymentBackup || '',
        expireMinutes: PAYMENT_ORDER_EXPIRE_MINUTES,
      },
      bot,
      package: pkg,
    });
  });

  router.post('/console/payments/check', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await pollPaymentOrders(inviteService);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/console/codes/stats/bots', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await getAllCodesStatsByBot());
  });

  router.get('/console/bots/:botId/codes', requireAdmin, async (req: Request, res: Response) => {
    const botId = parseInteger(req.params.botId);
    if (!botId) {
      res.status(400).json({ error: '缺少有效的 botId' });
      return;
    }
    res.json(await getBotCodesDetail(botId));
  });

  router.post('/console/bots/:botId/codes', requireAdmin, async (req: Request, res: Response) => {
    const botId = parseInteger(req.params.botId);
    const count = parseInteger(req.body.count);
    const ttlHours = parseInteger(req.body.ttlHours);
    const customerId = readCustomerId(req) ?? 0;
    if (!botId || !count || count <= 0) {
      res.status(400).json({ error: '缺少有效的 botId 或 count' });
      return;
    }

    const created = await inviteService.createCodes(count, (ttlHours || 12) * 3600, 2);
    const codes = created.map((item) => item.code);
    const saved = await addBotCodes(botId, codes, customerId);
    if (!saved) {
      res.status(500).json({ error: '写入授权码失败' });
      return;
    }

    res.json({ ok: true, codes });
  });

  router.get('/console/codes/:code', requireAdmin, async (req: Request, res: Response) => {
    const detail = await getCodeDetail(readParam(req.params.code));
    if (!detail) {
      res.status(404).json({ error: '授权码不存在' });
      return;
    }
    res.json(detail);
  });

  router.post('/console/codes/:code/release', requireAdmin, async (req: Request, res: Response) => {
    const code = readParam(req.params.code).trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: '缺少 code' });
      return;
    }

    const released = await inviteService.releaseRoom(code);
    if (!released) {
      res.status(500).json({ error: '释放授权码失败' });
      return;
    }

    await markCodeUnused(code);
    res.json({ ok: true });
  });

  router.delete('/console/codes/:code', requireAdmin, async (req: Request, res: Response) => {
    const code = readParam(req.params.code).trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: '缺少 code' });
      return;
    }

    const detail = await getCodeDetail(code);
    if (detail?.status === 'in_use') {
      res.status(409).json({ error: '授权码正在使用中，不能删除' });
      return;
    }

    const [inviteDeleted, userDeleted] = await Promise.all([
      inviteService.revokeInvite(code),
      deleteUserCode(code),
    ]);

    res.json({ ok: inviteDeleted && userDeleted });
  });

  router.get('/console/bots/:botId/bindings', requireAdmin, async (req: Request, res: Response) => {
    const botId = parseInteger(req.params.botId);
    if (!botId) {
      res.status(400).json({ error: '缺少有效的 botId' });
      return;
    }
    res.json(await getBotBindings(botId));
  });

  router.post('/console/bots/:botId/bindings', requireAdmin, async (req: Request, res: Response) => {
    const botId = parseInteger(req.params.botId);
    const customerId = readCustomerId(req);
    if (!botId || !customerId) {
      res.status(400).json({ error: '缺少有效的 botId 或 customerId' });
      return;
    }
    res.json({ ok: true, result: await bindBotUser(botId, customerId) });
  });

  router.delete('/console/bots/:botId/bindings/:customerId', requireAdmin, async (req: Request, res: Response) => {
    const botId = parseInteger(req.params.botId);
    const customerId = parseInteger(req.params.customerId);
    if (!botId || !customerId) {
      res.status(400).json({ error: '缺少有效的 botId 或 customerId' });
      return;
    }
    res.json({ ok: await unbindBotUser(botId, customerId) });
  });
}