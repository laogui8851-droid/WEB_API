import { RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk';
import { HealthStatus, RoomInfo } from './models';
import { InviteService } from './tokenService';
import { getSupabase } from './database';

interface ServerConfig {
  host: string;
  apiKey: string;
  apiSecret: string;
}

export class LiveKitService {
  private primary: ServerConfig;
  private fallback: ServerConfig | null = null;
  private activePrimary = true;
  private primaryHealthy = true;
  private lastHealthCheck = new Date(0); // 初始为很久以前，强制首次检查
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private inviteService: InviteService;
  private isServerless: boolean;
  private healthCacheTTL = 60000; // 健康状态缓存 60 秒
  private autoReleaseTimer: NodeJS.Timeout | null = null;

  constructor(primary: ServerConfig, fallback: ServerConfig | null, checkInterval: number) {
    this.primary = primary;
    this.fallback = fallback;
    this.inviteService = new InviteService(primary.apiKey, primary.apiSecret, primary.host);
    this.isServerless = !!process.env.VERCEL;

    if (this.isServerless) {
      // Vercel 无服务器模式：启动时从数据库加载上次健康状态
      this.loadHealthState();
    } else {
      // 传统模式：定时健康检查
      this.healthCheckTimer = setInterval(() => this.checkHealth(), checkInterval);
      this.checkHealth();
      this.autoReleaseTimer = setInterval(() => {
        void this.autoReleaseRooms();
      }, 30000);
      void this.autoReleaseRooms();
    }
  }

  // 从 Supabase 加载健康状态（无服务器模式用）
  private async loadHealthState() {
    try {
      const db = getSupabase();
      const { data } = await db
        .from('health_state')
        .select('*')
        .eq('id', 'primary')
        .single();

      if (data) {
        this.primaryHealthy = data.healthy;
        this.activePrimary = data.active_primary;
        this.lastHealthCheck = new Date(data.last_checked);

        if (!this.activePrimary && this.fallback) {
          this.inviteService.updateServer(this.fallback.apiKey, this.fallback.apiSecret, this.fallback.host);
        }
      }
    } catch {
      // 表不存在或查询失败，用默认值
    }
  }

  // 保存健康状态到 Supabase（无服务器模式用）
  private async saveHealthState() {
    if (!this.isServerless) return;
    try {
      const db = getSupabase();
      await db.from('health_state').upsert({
        id: 'primary',
        healthy: this.primaryHealthy,
        active_primary: this.activePrimary,
        last_checked: this.lastHealthCheck.toISOString(),
      });
    } catch {
      // 保存失败不影响主流程
    }
  }

  // 确保健康状态是新鲜的（无服务器模式用，每次请求前调用）
  async ensureHealthy() {
    if (!this.isServerless) return;

    const now = Date.now();
    const elapsed = now - this.lastHealthCheck.getTime();

    // 如果上次是健康的，缓存 60 秒不重复检查
    if (this.primaryHealthy && elapsed < this.healthCacheTTL) return;

    // 如果上次不健康，每次请求都尝试恢复检查
    await this.checkHealth();
    await this.autoReleaseRooms();
  }

  getInviteService(): InviteService {
    return this.inviteService;
  }

  private getActiveConfig(): ServerConfig {
    if (this.activePrimary) return this.primary;
    if (this.fallback) return this.fallback;
    return this.primary;
  }

  private getRoomService(): RoomServiceClient {
    const config = this.getActiveConfig();
    return new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  }

  private getEgressClient(): EgressClient {
    const config = this.getActiveConfig();
    return new EgressClient(config.host, config.apiKey, config.apiSecret);
  }

  // ====== 健康检查 ======
  async checkHealth(): Promise<boolean> {
    try {
      const roomService = new RoomServiceClient(
        this.primary.host,
        this.primary.apiKey,
        this.primary.apiSecret
      );
      await roomService.listRooms();
      this.primaryHealthy = true;
      this.lastHealthCheck = new Date();

      // 如果主服务器恢复，切回主服务器
      if (!this.activePrimary) {
        console.log('[故障转移] 主服务器恢复，切回主服务器');
        this.activePrimary = true;
        this.inviteService.updateServer(this.primary.apiKey, this.primary.apiSecret, this.primary.host);
      }

      await this.saveHealthState();
      return true;
    } catch (err) {
      console.error('[健康检查] 主服务器不可用:', (err as Error).message);
      this.primaryHealthy = false;
      this.lastHealthCheck = new Date();

      // 切换到备用服务器
      if (this.fallback && this.activePrimary) {
        console.log('[故障转移] 切换到备用服务器:', this.fallback.host);
        this.activePrimary = false;
        this.inviteService.updateServer(this.fallback.apiKey, this.fallback.apiSecret, this.fallback.host);
      }

      await this.saveHealthState();
      return false;
    }
  }

  getHealthStatus(): HealthStatus {
    return {
      primary: {
        url: this.primary.host,
        healthy: this.primaryHealthy,
        lastChecked: this.lastHealthCheck.toISOString(),
      },
      fallback: {
        url: this.fallback?.host || '未配置',
        configured: !!this.fallback,
      },
      activeServer: this.activePrimary ? 'primary' : 'fallback',
    };
  }

  // ====== 房间管理 ======
  async listRooms(): Promise<RoomInfo[]> {
    const roomService = this.getRoomService();
    const rooms = await roomService.listRooms();
    return rooms.map((r) => ({
      name: r.name,
      numParticipants: r.numParticipants,
      createdAt: r.creationTime,
      activeRecording: r.activeRecording,
    }));
  }

  async autoReleaseRooms(): Promise<number> {
    try {
      const rooms = await this.listRooms();
      const activeRoomNames = rooms
        .filter((room) => room.numParticipants > 0)
        .map((room) => room.name);
      const releasedCount = await this.inviteService.autoReleaseInactiveRooms(activeRoomNames);
      if (releasedCount > 0) {
        console.log(`[自动释放] 已自动释放 ${releasedCount} 个已结束会议的房间绑定`);
      }
      return releasedCount;
    } catch (err) {
      console.error('[自动释放] 检查房间释放状态失败:', (err as Error).message);
      return 0;
    }
  }

  async createRoom(roomName: string, emptyTimeout?: number, maxParticipants?: number) {
    const roomService = this.getRoomService();
    return await roomService.createRoom({
      name: roomName,
      emptyTimeout: emptyTimeout || 600, // 10 分钟无人自动关闭
      maxParticipants: maxParticipants || 2, // 1v1 默认最多 2 人
    });
  }

  async deleteRoom(roomName: string) {
    const roomService = this.getRoomService();
    await roomService.deleteRoom(roomName);
  }

  // ====== 录制 ======
  async startRecording(roomName: string, outputFile?: string) {
    const egress = this.getEgressClient();
    const filename = outputFile || `recording-${roomName}-${Date.now()}.mp4`;
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `/recordings/${filename}`,
    });
    const info = await egress.startRoomCompositeEgress(roomName, { file: fileOutput });
    return {
      egressId: info.egressId,
      roomName,
      filename,
      status: 'recording',
    };
  }

  async stopRecording(egressId: string) {
    const egress = this.getEgressClient();
    const info = await egress.stopEgress(egressId);
    return {
      egressId: info.egressId,
      status: 'stopped',
    };
  }

  async listRecordings() {
    const egress = this.getEgressClient();
    const list = await egress.listEgress();
    return list.map((e) => ({
      egressId: e.egressId,
      roomName: e.roomName,
      status: e.status,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
    }));
  }

  destroy() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.autoReleaseTimer) {
      clearInterval(this.autoReleaseTimer);
    }
  }
}
