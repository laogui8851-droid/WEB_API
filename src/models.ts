// 邀请码记录
export interface InviteCode {
  id: string;
  code: string;              // 短邀请码，如 ABC123
  roomName: string | null;   // 绑定的房间名，首次加入时绑定
  createdAt: Date;
  activatedAt: Date | null;
  expiresAt: Date | null;
  ttlSeconds: number;
  maxParticipants: number;
}

// 创建邀请码请求（只需时间和人数，不需要房间名）
export interface CreateInviteRequest {
  ttlSeconds?: number;       // 有效期，默认 3600 秒（1小时）
  maxParticipants?: number;  // 最大人数，默认 2
}

// 创建邀请码响应
export interface InviteResponse {
  code: string;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  maxParticipants: number;
}

// 加入房间请求：用户输入邀请码 + 自己设的房间名 + 身份
export interface JoinRequest {
  code: string;       // 邀请码
  roomName: string;   // 用户自己设置的房间名
  identity: string;   // 用户标识（昵称）
  name?: string;
}

// 加入房间响应
export interface JoinResponse {
  token: string;       // LiveKit Token（内部生成，客户端用来连接）
  url: string;         // LiveKit 服务器地址
  roomName: string;
  expiresAt?: string | null;
}

export interface CodeRecord {
  code: string;
  status: 'available' | 'assigned';
  in_use: boolean;
  expires_at: string | null;
  bound_room: string | null;
  created_at: string;
  activated_at: string | null;
  max_participants: number;
}

// 房间信息
export interface RoomInfo {
  name: string;
  numParticipants: number;
  createdAt: number | bigint;
  activeRecording: boolean;
}

// 健康检查状态
export interface HealthStatus {
  primary: {
    url: string;
    healthy: boolean;
    lastChecked: string;
  };
  fallback: {
    url: string;
    configured: boolean;
  };
  activeServer: 'primary' | 'fallback';
}

// 录制请求
export interface RecordingRequest {
  roomName: string;
  outputFile?: string;
}
