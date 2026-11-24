import { Router, Request, Response } from 'express';
import { db } from '../db/index';
import { schedulerService } from '../services/scheduler';

export const healthRouter = Router();

// GET /api/v1/health or /health
healthRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  let dbStatus = 'ok';
  try {
    await db.query('SELECT 1');
  } catch (err) {
    dbStatus = 'error';
  }

  const schedulerStatus = schedulerService.getStatus();
  const telegramStatus = process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured';

  const isHealthy = dbStatus === 'ok';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    database: {
      status: dbStatus,
      engine: db.isUsingPostgres() ? 'postgresql' : 'sqlite3_relational',
    },
    telegram: {
      status: telegramStatus,
      managerId: process.env.MANAGER_TELEGRAM_ID ? 'configured' : 'default',
    },
    scheduler: {
      running: schedulerStatus.scheduler.running,
      pid: schedulerStatus.scheduler.pid,
      uptimeSeconds: schedulerStatus.scheduler.uptimeSeconds,
    },
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/db', async (_req: Request, res: Response): Promise<void> => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', engine: db.isUsingPostgres() ? 'postgresql' : 'sqlite3_relational' });
  } catch (err) {
    res.status(503).json({ status: 'error', error: (err as Error).message });
  }
});

healthRouter.get('/telegram', (_req: Request, res: Response): void => {
  res.json({
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    managerId: process.env.MANAGER_TELEGRAM_ID || '320314713',
  });
});
