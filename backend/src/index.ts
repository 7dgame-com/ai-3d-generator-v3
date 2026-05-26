/**
 * AI 3D 模型生成插件 - 后端入口文件
 *
 * 配置 Express 应用，注册中间件和路由，启动 HTTP 服务器。
 */

import 'dotenv/config';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { testConnection } from './db/connection';
import { ensureSchemaReady } from './db/schemaHealth';
import { startPoller } from './services/taskPoller';
import { startTimeoutGuardian, stopTimeoutGuardian } from './services/timeoutGuardian';
import { resolveEnabledProviders } from './config/providers';
import { assertRuntimeConfig, validateRuntimeConfig } from './config/runtime';
import { providerRegistry } from './adapters/ProviderRegistry';
import { Tripo3DAdapter } from './adapters/Tripo3DAdapter';
import { hyper3dAdapter } from './adapters/Hyper3DAdapter';
import { getTripoRegion } from './services/tripoRegion';
import adminRoutes from './routes/admin';
import directTaskRoutes from './routes/directTask';
import taskRoutes from './routes/task';
import usageRoutes from './routes/usage';
import downloadRoutes from './routes/download';
import creditsRoutes from './routes/credits';
import thumbnailRoutes from './routes/thumbnail';

const app = express();
const PORT: string | number = process.env.PORT || 8089;
const VERSION = '3.0.0';

type CheckStatus = 'starting' | 'ok' | 'error';

interface HealthCheck {
  status: CheckStatus;
  message?: string;
  details?: unknown;
}

interface HealthState {
  status: CheckStatus;
  version: string;
  checks: {
    runtimeConfig: HealthCheck;
    database: HealthCheck;
    schema: HealthCheck;
    providers: HealthCheck;
    workers: HealthCheck;
  };
  error?: string;
}

const healthState: HealthState = {
  status: 'starting',
  version: VERSION,
  checks: {
    runtimeConfig: { status: 'starting' },
    database: { status: 'starting' },
    schema: { status: 'starting' },
    providers: { status: 'starting' },
    workers: { status: 'starting' },
  },
};

function markCheck(name: keyof HealthState['checks'], check: HealthCheck): void {
  healthState.checks[name] = check;
}

function markBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  healthState.status = 'error';
  healthState.error = message;
}

// ========== CORS 配置 ==========
app.use(
  cors({
    origin: [
      'http://localhost:3008', // 插件前端开发服务器
      'http://localhost:3001', // 主前端开发服务器
      'https://a23.plugins.xrugc.com', // 插件前端线上域名
    ],
    credentials: true,
  })
);

// ========== 请求体解析 ==========
app.use(express.json({ limit: '50mb' }));

// ========== 健康检查 ==========
app.get('/health', (_req: Request, res: Response) => {
  const httpStatus = healthState.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(healthState);
});

// ========== 路由注册 ==========
// nginx rewrite 会去掉 /backend/ 前缀，所以这里挂载到根路径
app.use('/', creditsRoutes);
app.use('/', adminRoutes);
app.use('/tasks', directTaskRoutes);
app.use('/tasks', taskRoutes);
app.use('/usage', usageRoutes);
app.use('/download', downloadRoutes);
app.use('/thumbnail', thumbnailRoutes);

// ========== 全局错误处理 ==========
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] 未处理的错误:', err.message);
  res.status(err.status || 500).json({
    code: 5001,
    message: err.message || '服务器内部错误',
  });
});

async function bootstrap(): Promise<void> {
  const runtimeConfig = validateRuntimeConfig();
  markCheck('runtimeConfig', {
    status: runtimeConfig.ok ? 'ok' : 'error',
    details: runtimeConfig.ok ? undefined : runtimeConfig.errors,
  });
  assertRuntimeConfig();

  await testConnection();
  markCheck('database', { status: 'ok' });

  const schemaStatus = await ensureSchemaReady();
  markCheck('schema', {
    status: 'ok',
    details: {
      database: schemaStatus.database,
      tableCount: schemaStatus.tableCount,
      autoInitialized: schemaStatus.autoInitialized,
    },
  });

  // ========== 注册启用的 Provider 适配器 ==========
  const enabledProviders = await resolveEnabledProviders();
  const adapterMap: Record<string, typeof hyper3dAdapter | Tripo3DAdapter> = {
    tripo3d: new Tripo3DAdapter(getTripoRegion),
    hyper3d: hyper3dAdapter,
  };
  for (const providerId of enabledProviders) {
    const adapter = adapterMap[providerId];
    if (adapter) {
      providerRegistry.register(adapter);
      console.log(`[Server] 已注册 Provider 适配器: ${providerId}`);
    }
  }

  markCheck('providers', { status: 'ok', details: { enabledProviders } });

  await startPoller();
  startTimeoutGuardian();
  markCheck('workers', { status: 'ok' });

  healthState.status = 'ok';
}

// ========== 启动服务器 ==========
app.listen(PORT, () => {
  console.log(`[AI 3D Generator] API 服务已启动，端口: ${PORT}`);
  void bootstrap().catch((err) => {
    markBootError(err);
    console.error('[Server] 关键服务启动失败，退出:', (err as Error).message);
    setTimeout(() => process.exit(1), 100);
  });
});

// ========== 进程退出时清理 ==========
process.on('SIGTERM', () => {
  console.log('[Server] 收到 SIGTERM，正在关闭...');
  stopTimeoutGuardian();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] 收到 SIGINT，正在关闭...');
  stopTimeoutGuardian();
  process.exit(0);
});
