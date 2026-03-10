import { Router, Request, Response } from 'express';
import { LiveKitService } from './livekitService';
import { CreateInviteRequest, JoinRequest } from './models';
import { requireEnv } from './env';

export function createRouter(lkService: LiveKitService): Router {
  const router = Router();
  const inviteService = lkService.getInviteService();
  const adminSecret = process.env.API_SECRET?.trim() || process.env.API_SECRET_KEY?.trim() || requireEnv('API_SECRET');

  const ensureHealthy = async (_req: Request, _res: Response, next: () => void) => {
    await lkService.ensureHealthy();
    next();
  };

  const requireAdmin = (req: Request, res: Response, next: () => void) => {
    const secret =
      (req.headers['x-api-secret'] as string | undefined) ||
      (req.headers['x-api-key'] as string | undefined);

    if (!adminSecret || secret !== adminSecret) {
      res.status(401).json({ error: '无效的 API 密钥' });
      return;
    }

    next();
  };

  const toIsolatedRoom = (code: string, roomName: string) => `${code.trim().toUpperCase()}-${roomName.trim()}`;

  const mapConnectionDetails = async (code: string, roomName: string, participantName: string) => {
    const isolatedRoom = toIsolatedRoom(code, roomName);
    const result = await inviteService.joinRoom({
      code,
      roomName: isolatedRoom,
      identity: participantName,
      name: participantName,
    });

    return {
      serverUrl: result.url,
      participantToken: result.token,
      participantName,
      roomName: isolatedRoom,
      expiresAt: result.expiresAt ?? null,
    };
  };

  router.use(ensureHealthy);

  // ====== 公开会议接口（xinbotapi 兼容） ======

  router.post('/room/join', async (req: Request, res: Response) => {
    try {
      const { code, room, identity, name } = req.body as {
        code?: string;
        room?: string;
        identity?: string;
        name?: string;
      };

      if (!code || !room || !identity) {
        res.status(400).json({ error: '缺少 code、room 或 identity' });
        return;
      }

      const result = await inviteService.joinRoom({
        code,
        roomName: room,
        identity,
        name,
      });

      res.json({
        serverUrl: result.url,
        token: result.token,
        server: 'primary',
        code: code.trim().toUpperCase(),
        roomName: result.roomName,
        expiresAt: result.expiresAt ?? null,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('无效') || message.includes('过期') || message.includes('绑定')) {
        res.status(403).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.post('/heartbeat', async (req: Request, res: Response) => {
    const { code } = req.body as { code?: string };
    if (code) {
      await inviteService.getInviteInfo(code);
    }
    res.json({ ok: true });
  });

  router.post('/room/leave', async (req: Request, res: Response) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) {
        res.status(400).json({ error: '缺少 code' });
        return;
      }

      const invite = await inviteService.getInviteInfo(code);
      const boundRoom = invite?.roomName ?? null;
      const released = await inviteService.releaseRoom(code);

      let destroyed: { message?: string } | Record<string, never> = {};
      if (released && boundRoom) {
        await lkService.deleteRoom(boundRoom).catch(() => undefined);
        destroyed = { message: `房间 "${boundRoom}" 已删除` };
      }

      res.json({ ok: true, room: boundRoom, destroyed });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/code/:code', async (req: Request, res: Response) => {
    try {
      const record = await inviteService.getCodeRecord(req.params.code as string);
      if (!record) {
        res.status(404).json({ error: '授权码不存在' });
        return;
      }

      res.json({
        code: record.code,
        status: record.status,
        in_use: record.in_use,
        expires_at: record.expires_at,
        bound_room: record.bound_room,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/api/connection-details', async (req: Request, res: Response) => {
    try {
      const authCode = String(req.query.authCode ?? '').trim();
      const roomName = String(req.query.roomName ?? '').trim();
      const participantName = String(req.query.participantName ?? '').trim();

      if (!roomName) {
        res.status(400).json({ error: '缺少房间名称' });
        return;
      }

      if (!participantName) {
        res.status(400).json({ error: '缺少参与者名称' });
        return;
      }

      if (!authCode) {
        res.status(401).json({ error: '请提供授权码' });
        return;
      }

      const result = await mapConnectionDetails(authCode, roomName, participantName);
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('无效') || message.includes('过期') || message.includes('绑定')) {
        res.status(401).json({ error: `授权码无效: ${message}` });
        return;
      }
      res.status(500).json({ error: `生成会议连接失败: ${message.slice(0, 120)}` });
    }
  });

  router.post('/api/heartbeat', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  router.post('/api/leave', async (req: Request, res: Response) => {
    try {
      const { authCode, force } = req.body as { authCode?: string; force?: boolean };
      if (force && authCode) {
        const invite = await inviteService.getInviteInfo(authCode);
        const boundRoom = invite?.roomName ?? null;
        await inviteService.releaseRoom(authCode);
        if (boundRoom) {
          await lkService.deleteRoom(boundRoom).catch(() => undefined);
        }
      }

      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ====== 管理接口（xinbotapi 兼容） ======

  router.post('/codes/create', requireAdmin, async (req: Request, res: Response) => {
    try {
      const count = Number(req.body.count ?? 1);
      const expireMinutes = Number(req.body.expire_minutes ?? 720);
      const maxParticipants = Number(req.body.maxParticipants ?? 2);
      const codes = await inviteService.createCodes(count, expireMinutes * 60, maxParticipants);
      res.json({ ok: true, created: codes.length, codes });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/codes', requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit ?? 100);
      const codes = await inviteService.listCodes(limit);
      res.json({ ok: true, count: codes.length, codes });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/codes/stats', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await inviteService.getCodeStats();
      res.json({ ok: true, ...stats });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/codes', requireAdmin, async (req: Request, res: Response) => {
    try {
      const codes = Array.isArray(req.body.codes) ? req.body.codes : [];
      const result = await inviteService.deleteCodes(codes);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 生成邀请码
  router.post('/invite', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ttlSeconds, maxParticipants } = req.body as CreateInviteRequest;
      const result = await inviteService.createInvite({ ttlSeconds, maxParticipants });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 用邀请码 + 房间名 + 身份 加入房间
  router.post('/join', async (req: Request, res: Response) => {
    try {
      const { code, roomName, identity } = req.body as JoinRequest;
      if (!code || !roomName || !identity) {
        res.status(400).json({ error: '缺少 code、roomName 或 identity' });
        return;
      }
      const result = await inviteService.joinRoom({ code, roomName, identity });
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('无效') || message.includes('过期') || message.includes('已绑定')) {
        res.status(403).json({ error: message });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  // 查询所有邀请码
  router.get('/invites', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const invites = await inviteService.getAllInvites();
      res.json(invites);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 查询单个邀请码信息
  router.get('/invite/:code', requireAdmin, async (req: Request, res: Response) => {
    try {
      const invite = await inviteService.getInviteInfo(req.params.code as string);
      if (!invite) {
        res.status(404).json({ error: '邀请码不存在' });
        return;
      }
      res.json(invite);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 释放房间（邀请码解绑房间，还能继续用来开新房间）
  router.post('/invite/release', async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) {
        res.status(400).json({ error: '缺少 code' });
        return;
      }
      const ok = await inviteService.releaseRoom(code);
      if (ok) {
        res.json({ message: `邀请码 "${code}" 的房间已释放，可以开新房间` });
      } else {
        res.status(500).json({ error: '释放失败' });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 撤销邀请码
  router.delete('/invite/:code', requireAdmin, async (req: Request, res: Response) => {
    try {
      const ok = await inviteService.revokeInvite(req.params.code as string);
      if (ok) {
        res.json({ message: `邀请码 "${req.params.code}" 已撤销` });
      } else {
        res.status(500).json({ error: '撤销失败' });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ====== 房间接口 ======

  // 列出所有房间
  router.get('/rooms', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const rooms = await lkService.listRooms();
      res.json({ ok: true, rooms });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 创建房间
  router.post('/rooms', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { roomName, emptyTimeout, maxParticipants } = req.body;
      if (!roomName) {
        res.status(400).json({ error: '缺少 roomName' });
        return;
      }
      const room = await lkService.createRoom(roomName, emptyTimeout, maxParticipants);
      res.json(room);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 删除房间
  router.delete('/rooms/:roomName', requireAdmin, async (req: Request, res: Response) => {
    try {
      await lkService.deleteRoom(req.params.roomName as string);
      res.json({ ok: true, message: `房间 "${req.params.roomName}" 已删除` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ====== 健康检查 ======

  router.get('/health', requireAdmin, async (_req: Request, res: Response) => {
    const status = lkService.getHealthStatus();
    const stats = await inviteService.getCodeStats().catch(() => ({ total: 0, available: 0, assigned: 0, in_use: 0 }));
    res.json({ ok: true, livekit: status, db: stats });
  });

  router.post('/health/check', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const healthy = await lkService.checkHealth();
      const status = lkService.getHealthStatus();
      res.json({ ...status, manualCheck: true, healthy });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/cleanup', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const releasedCount = await lkService.autoReleaseRooms();
      res.json({ ok: true, expired_sessions: releasedCount ?? 0 });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ====== 录制接口 ======

  // 开始录制
  router.post('/recording/start', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { roomName, outputFile } = req.body;
      if (!roomName) {
        res.status(400).json({ error: '缺少 roomName' });
        return;
      }
      const result = await lkService.startRecording(roomName, outputFile);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 停止录制
  router.post('/recording/stop', requireAdmin, async (req: Request, res: Response) => {
    try {
      const { egressId } = req.body;
      if (!egressId) {
        res.status(400).json({ error: '缺少 egressId' });
        return;
      }
      const result = await lkService.stopRecording(egressId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 列出录制
  router.get('/recordings', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const list = await lkService.listRecordings();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
