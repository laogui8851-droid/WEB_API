import { AccessToken } from 'livekit-server-sdk';
import { getSupabase } from './database';
import { InviteCode, CreateInviteRequest, InviteResponse, JoinRequest, JoinResponse, CodeRecord } from './models';
import crypto from 'crypto';

export class InviteService {
  private apiKey: string;
  private apiSecret: string;
  private serverUrl: string;

  constructor(apiKey: string, apiSecret: string, serverUrl: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.serverUrl = serverUrl;
  }

  updateServer(apiKey: string, apiSecret: string, serverUrl: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.serverUrl = serverUrl;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private mapCodeRecord(data: any): CodeRecord {
    const expiresAt = data.expires_at ?? null;
    const roomName = data.room_name ?? null;
    const isActive = !!roomName && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
    const isAssigned = isActive || data.assigned_to !== null;

    return {
      code: data.code,
      status: isAssigned || !!(data.assigned_name ?? '').trim() ? 'assigned' : 'available',
      in_use: isActive,
      expires_at: expiresAt,
      bound_room: roomName,
      created_at: data.created_at,
      activated_at: data.activated_at ?? null,
      max_participants: data.max_participants,
      assigned_to: data.assigned_to ?? null,
      assigned_name: data.assigned_name ?? '',
      note: data.note ?? '',
    };
  }

  // 生成 6 位邀请码
  private generateCode(): string {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); // 如 A3F2B1
  }

  // 创建邀请码
  async createInvite(request: CreateInviteRequest): Promise<InviteResponse> {
    const { ttlSeconds = 3600, maxParticipants = 2, assignedTo = null, assignedName = '', note = '' } = request;
    const db = getSupabase();

    // 清理过期邀请码
    await db.from('invite_codes').delete().lt('expires_at', new Date().toISOString());

    const code = this.generateCode();
    const now = new Date();

    const { error } = await db.from('invite_codes').insert({
      code,
      room_name: null,
      created_at: now.toISOString(),
      activated_at: null,
      expires_at: null,
      ttl_seconds: ttlSeconds,
      max_participants: maxParticipants,
      assigned_to: assignedTo,
      assigned_name: assignedName,
      note,
    });

    if (error) {
      throw new Error(`创建邀请码失败: ${error.message}`);
    }

    return {
      code,
      createdAt: now.toISOString(),
      activatedAt: null,
      expiresAt: null,
      maxParticipants,
    };
  }

  async createCodes(
    count: number,
    ttlSeconds: number,
    maxParticipants = 2,
    options?: { assignedTo?: number | null; assignedName?: string; note?: string },
  ): Promise<CodeRecord[]> {
    const records: CodeRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      const invite = await this.createInvite({
        ttlSeconds,
        maxParticipants,
        assignedTo: options?.assignedTo ?? null,
        assignedName: options?.assignedName ?? '',
        note: options?.note ?? '',
      });
      records.push({
        code: invite.code,
        status: (options?.assignedTo !== undefined && options?.assignedTo !== null) || !!(options?.assignedName ?? '').trim() ? 'assigned' : 'available',
        in_use: false,
        expires_at: invite.expiresAt,
        bound_room: null,
        created_at: invite.createdAt,
        activated_at: invite.activatedAt,
        max_participants: invite.maxParticipants,
        assigned_to: options?.assignedTo ?? null,
        assigned_name: options?.assignedName ?? '',
        note: options?.note ?? '',
      });
    }
    return records;
  }

  async listCodes(limit = 100, options?: { status?: string; assignedTo?: number | null; assignedName?: string }): Promise<CodeRecord[]> {
    const db = getSupabase();
    let query = db
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (options?.assignedTo !== undefined && options.assignedTo !== null) {
      query = query.eq('assigned_to', options.assignedTo);
    }
    if (options?.assignedName) {
      query = query.eq('assigned_name', options.assignedName);
    }

    const fetchLimit = options?.status ? Math.max(limit * 5, 100) : limit;
    const { data, error } = await query.limit(fetchLimit);

    if (error || !data) {
      throw new Error(`查询邀请码失败: ${error?.message ?? '未知错误'}`);
    }

    let rows = data.map((item: any) => this.mapCodeRecord(item));
    if (options?.status) {
      rows = rows.filter((item: CodeRecord) => item.status === options.status);
    }
    return rows.slice(0, limit);
  }

  async getCodeStats(): Promise<{ total: number; available: number; assigned: number; in_use: number }> {
    const rows = await this.listCodes(1000);
    const assigned = rows.filter((item) => item.status === 'assigned').length;
    const inUse = rows.filter((item) => item.in_use).length;
    return {
      total: rows.length,
      available: rows.length - assigned,
      assigned,
      in_use: inUse,
    };
  }

  async getCodeRecord(code: string): Promise<CodeRecord | null> {
    const db = getSupabase();
    const normalizedCode = this.normalizeCode(code);
    const { data, error } = await db
      .from('invite_codes')
      .select('*')
      .eq('code', normalizedCode)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return this.mapCodeRecord(data);
  }

  async deleteCodes(codes: string[]): Promise<{ deleted: number; failed: string[] }> {
    const db = getSupabase();
    let deleted = 0;
    const failed: string[] = [];

    for (const rawCode of codes) {
      const code = this.normalizeCode(rawCode);
      const record = await this.getCodeRecord(code);
      if (!record || record.in_use) {
        failed.push(code);
        continue;
      }

      const { error } = await db.from('invite_codes').delete().eq('code', code);
      if (error) {
        failed.push(code);
        continue;
      }
      deleted += 1;
    }

    return { deleted, failed };
  }

  // 用邀请码 + 房间名 + 身份 加入房间
  async joinRoom(request: JoinRequest): Promise<JoinResponse> {
    const { roomName, identity } = request;
    const code = this.normalizeCode(request.code);
    const displayName = request.name?.trim() || identity;
    const db = getSupabase();

    // 查找邀请码
    const { data: invite, error: findErr } = await db
      .from('invite_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (findErr || !invite) {
      throw new Error('邀请码无效或已过期');
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      throw new Error('邀请码无效或已过期');
    }

    let effectiveInvite = invite;

    // 如果邀请码还没绑定房间，绑定到用户设置的房间名
    if (!invite.room_name) {
      const activatedAt = invite.activated_at || new Date().toISOString();
      const expiresAt = invite.expires_at || new Date(Date.now() + invite.ttl_seconds * 1000).toISOString();
      const { error: updateErr } = await db
        .from('invite_codes')
        .update({ room_name: roomName, activated_at: activatedAt, expires_at: expiresAt })
        .eq('id', invite.id);

      if (updateErr) {
        throw new Error(`绑定房间失败: ${updateErr.message}`);
      }
      effectiveInvite = { ...invite, room_name: roomName, activated_at: activatedAt, expires_at: expiresAt };
    } else if (invite.room_name !== roomName) {
      // 邀请码已绑定到另一个房间
      throw new Error(`此邀请码已绑定房间 "${invite.room_name}"，不能用于房间 "${roomName}"`);
    }

    // 生成 LiveKit Token
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      ttl: Math.floor((new Date(effectiveInvite.expires_at).getTime() - Date.now()) / 1000),
      name: displayName,
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    return {
      token,
      url: this.serverUrl,
      roomName,
      expiresAt: effectiveInvite.expires_at,
    };
  }

  // 查询邀请码信息
  async getInviteInfo(code: string): Promise<InviteCode | null> {
    const db = getSupabase();
    const { data, error } = await db
      .from('invite_codes')
      .select('*')
      .eq('code', this.normalizeCode(code))
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      code: data.code,
      roomName: data.room_name,
      createdAt: new Date(data.created_at),
      activatedAt: data.activated_at ? new Date(data.activated_at) : null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      ttlSeconds: data.ttl_seconds,
      maxParticipants: data.max_participants,
    };
  }

  // 列出所有有效邀请码
  async getAllInvites(): Promise<InviteCode[]> {
    const db = getSupabase();
    const { data, error } = await db
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    return data
      .filter((d: any) => !d.expires_at || new Date(d.expires_at).getTime() > Date.now())
      .map((d: any) => ({
      id: d.id,
      code: d.code,
      roomName: d.room_name,
      createdAt: new Date(d.created_at),
      activatedAt: d.activated_at ? new Date(d.activated_at) : null,
      expiresAt: d.expires_at ? new Date(d.expires_at) : null,
      ttlSeconds: d.ttl_seconds,
      maxParticipants: d.max_participants,
    }));
  }

  // 释放房间（把邀请码的 room_name 清空，下次可以开新房间）
  async releaseRoom(code: string): Promise<boolean> {
    const db = getSupabase();
    const { error } = await db
      .from('invite_codes')
      .update({ room_name: null })
      .eq('code', this.normalizeCode(code))
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    return !error;
  }

  async autoReleaseInactiveRooms(activeRoomNames: string[]): Promise<number> {
    const db = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('invite_codes')
      .select('code, room_name')
      .not('room_name', 'is', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`);

    if (error || !data || data.length === 0) {
      return 0;
    }

    const activeRooms = new Set(activeRoomNames);
    const releasableCodes = data
      .filter((item: any) => item.room_name && !activeRooms.has(item.room_name))
      .map((item: any) => item.code);

    if (releasableCodes.length === 0) {
      return 0;
    }

    const { error: updateErr } = await db
      .from('invite_codes')
      .update({ room_name: null })
      .in('code', releasableCodes);

    if (updateErr) {
      throw new Error(`自动释放房间失败: ${updateErr.message}`);
    }

    return releasableCodes.length;
  }

  // 撤销邀请码
  async revokeInvite(code: string): Promise<boolean> {
    const db = getSupabase();
    const { error } = await db.from('invite_codes').delete().eq('code', this.normalizeCode(code));
    return !error;
  }
}
