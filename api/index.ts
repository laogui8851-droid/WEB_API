import express from 'express';
import cors from 'cors';
import { LiveKitService } from '../dist/livekitService';
import { createRouter } from '../dist/routes';
import { initSupabase } from '../dist/database';
import { readOptionalServerConfig, requireEnv } from '../dist/env';

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseKey = requireEnv('SUPABASE_SERVICE_KEY');
initSupabase(supabaseUrl, supabaseKey);

const primary = {
  host: requireEnv('LIVEKIT_HOST'),
  apiKey: requireEnv('LIVEKIT_API_KEY'),
  apiSecret: requireEnv('LIVEKIT_API_SECRET'),
};

const fallback = readOptionalServerConfig('LIVEKIT_CLOUD');

const lkService = new LiveKitService(primary, fallback, 999999999);

const router = createRouter(lkService);
app.use('/api', router);
// 兼容 xinbotapi（iOS旧包直接访问 /room/join 等无前缀路径）
app.use('/', router);

// 根路径
app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'LiveKit Translate API' });
});

export default app;
