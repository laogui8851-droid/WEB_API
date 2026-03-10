function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

export function readIntEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`环境变量 ${name} 不是有效整数`);
  }

  return parsed;
}

export function readOptionalServerConfig(prefix: string) {
  const host = readEnv(`${prefix}_HOST`);
  if (!host) {
    return null;
  }

  return {
    host,
    apiKey: requireEnv(`${prefix}_API_KEY`),
    apiSecret: requireEnv(`${prefix}_API_SECRET`),
  };
}
