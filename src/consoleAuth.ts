import jwt, { SignOptions } from 'jsonwebtoken';

type AdminConsoleTokenPayload = {
  sub: string;
  role: 'admin-console';
};

function readConsoleUsername(): string | null {
  return process.env.ADMIN_CONSOLE_USERNAME?.trim() || null;
}

function readConsolePassword(): string | null {
  return process.env.ADMIN_CONSOLE_PASSWORD?.trim() || null;
}

function readJwtSecret(): string {
  return (
    process.env.ADMIN_CONSOLE_JWT_SECRET?.trim() ||
    process.env.API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ''
  );
}

function readTokenExpiresIn(): string {
  return process.env.ADMIN_CONSOLE_JWT_EXPIRES_IN?.trim() || '12h';
}

export function isConsoleLoginConfigured(): boolean {
  return !!readConsoleUsername() && !!readConsolePassword() && !!readJwtSecret();
}

export function createConsoleToken(username: string, password: string): string {
  const configuredUsername = readConsoleUsername();
  const configuredPassword = readConsolePassword();
  const jwtSecret = readJwtSecret();

  if (!configuredUsername || !configuredPassword || !jwtSecret) {
    throw new Error('后台登录未配置，请设置 ADMIN_CONSOLE_USERNAME、ADMIN_CONSOLE_PASSWORD、ADMIN_CONSOLE_JWT_SECRET');
  }

  if (username !== configuredUsername || password !== configuredPassword) {
    throw new Error('账号或密码错误');
  }

  return jwt.sign(
    {
      sub: configuredUsername,
      role: 'admin-console',
    } satisfies AdminConsoleTokenPayload,
    jwtSecret,
    { expiresIn: readTokenExpiresIn() as SignOptions['expiresIn'] },
  );
}

export function verifyConsoleToken(token: string): AdminConsoleTokenPayload {
  const jwtSecret = readJwtSecret();
  if (!jwtSecret) {
    throw new Error('后台登录未配置');
  }

  const payload = jwt.verify(token, jwtSecret);
  if (!payload || typeof payload !== 'object') {
    throw new Error('无效的登录令牌');
  }

  const maybePayload = payload as Partial<AdminConsoleTokenPayload>;
  if (maybePayload.role !== 'admin-console' || typeof maybePayload.sub !== 'string') {
    throw new Error('无效的登录令牌');
  }

  return {
    sub: maybePayload.sub,
    role: 'admin-console',
  };
}

export function readBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}