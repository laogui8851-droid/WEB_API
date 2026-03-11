import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { LiveKitService } from './livekitService';
import { createRouter } from './routes';
import { initSupabase } from './database';
import { readIntEnv, readOptionalServerConfig, requireEnv } from './env';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

try {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_KEY');
  initSupabase(supabaseUrl, supabaseKey);
  console.log('Supabase 已连接:', supabaseUrl);

  const primary = {
    host: requireEnv('LIVEKIT_HOST'),
    apiKey: requireEnv('LIVEKIT_API_KEY'),
    apiSecret: requireEnv('LIVEKIT_API_SECRET'),
  };

  const fallback = readOptionalServerConfig('LIVEKIT_CLOUD');
  const checkInterval = readIntEnv('HEALTH_CHECK_INTERVAL', 30000);

  // 初始化 LiveKit 服务
  const lkService = new LiveKitService(primary, fallback, checkInterval);

  // 注册路由
  const router = createRouter(lkService);
  app.use('/api', router);
  // 兼容 xinbotapi（iOS旧包直接访问 /room/join 等无前缀路径）
  app.use('/', router);

// 根路径
app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'LiveKit Translate API' });
});

  const port = readIntEnv('PORT', 3000);
  app.listen(port, () => {
    console.log(`API 服务已启动: http://localhost:${port}`);
    console.log(`主服务器: ${primary.host}`);
    if (fallback) {
      console.log(`备用服务器: ${fallback.host}`);
    } else {
      console.log('备用服务器: 未配置');
    }
  });

  process.on('SIGTERM', () => {
    lkService.destroy();
    process.exit(0);
  });
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
