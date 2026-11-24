import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { db } from './server/db/index';
import { authenticate, csrfProtection } from './server/middleware/auth';
import { authRouter } from './server/routes/auth';
import { organizationRouter } from './server/routes/organization';
import { billingRouter } from './server/routes/billing';
import { publicRouter } from './server/routes/public';
import { staffRouter } from './server/routes/staff';
import { checkinsRouter } from './server/routes/checkins';
import { salesRouter } from './server/routes/sales';
import { messagesRouter } from './server/routes/messages';
import { notificationsRouter } from './server/routes/notifications';
import { applicationsRouter } from './server/routes/applications';
import { ratesRouter } from './server/routes/rates';
import { locationsRouter } from './server/routes/locations';
import { botRouter } from './server/routes/bot';
import { telegramRouter } from './server/routes/telegram';
import { auditRouter } from './server/routes/audit';
import { healthRouter } from './server/routes/health';
import { swapsRouter } from './server/routes/swaps';
import { availabilityRouter } from './server/routes/availability';
import { schedulesRouter } from './server/routes/schedules';
import { goalsRouter } from './server/routes/goals';
import { paybackRouter } from './server/routes/payback';
import { schedulerService } from './server/services/scheduler';
import { SEO_META_BY_PATH } from './src/config/site';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const isDev = process.env.NODE_ENV !== 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors *;"
  );

  if (!isDev) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(authenticate);
app.use('/api', csrfProtection);

// API v1 Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organization', organizationRouter);
app.use('/api/v1/billing', billingRouter);
app.use('/api/v1/public', publicRouter);
app.use('/api/v1/staff', staffRouter);
app.use('/api/v1/checkins', checkinsRouter);
app.use(['/api/v1/checkin-alerts', '/api/checkin-alerts'], checkinsRouter);
app.use('/api/v1/sales', salesRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/applications', applicationsRouter);
app.use('/api/v1/rates', ratesRouter);
app.use('/api/v1/locations', locationsRouter);
app.use('/api/v1/swaps', swapsRouter);
app.use('/api/v1/availability', availabilityRouter);
app.use('/api/v1/schedules', schedulesRouter);
app.use(['/api/v1/income-goals', '/api/v1/goals'], goalsRouter);
app.use('/api/v1/payback', paybackRouter);
app.use('/api/v1/bot', botRouter);
app.use('/api/v1/telegram', telegramRouter);
app.use('/api/v1/audit-logs', auditRouter);
app.use('/api/v1/health', healthRouter);

// Fallback aliases without /v1/
app.use('/api/auth', authRouter);
app.use('/api/organization', organizationRouter);
app.use('/api/billing', billingRouter);
app.use('/api/public', publicRouter);
app.use('/api/staff', staffRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/rates', ratesRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/swaps', swapsRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/payback', paybackRouter);
app.use('/api/bot', botRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/health', healthRouter);
app.use('/health', healthRouter);

function getBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = req.get('host') || `localhost:${port}`;
  return `${proto}://${host}`;
}

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectRouteSeoAndAnalytics(html: string, req: Request): string {
  const cleanPath = (req.path || '/').replace(/\/+$/, '') || '/';
  const metaKey = cleanPath.startsWith('/app') ? '/app' : cleanPath;
  const meta = SEO_META_BY_PATH[metaKey] || SEO_META_BY_PATH['/'];
  const baseUrl = getBaseUrl(req);
  const canonicalUrl = `${baseUrl}${cleanPath === '/' ? '' : cleanPath}`;
  const isNoIndex = cleanPath.startsWith('/app') || cleanPath === '/login';

  const safeTitle = escapeHtmlAttr(meta.title);
  const safeDesc = escapeHtmlAttr(meta.description);
  const safeCanonical = escapeHtmlAttr(canonicalUrl);

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${safeDesc}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${safeTitle}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${safeDesc}" />`);

  const extraHeadTags: string[] = [
    `<link rel="canonical" href="${safeCanonical}" />`,
    `<meta property="og:url" content="${safeCanonical}" />`,
    `<meta name="robots" content="${isNoIndex ? 'noindex, nofollow' : 'index, follow'}" />`,
  ];

  if (cleanPath === '/') {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'SKLADIN',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'ru',
      url: baseUrl,
      description: meta.description,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'RUB',
        lowPrice: '1900',
        highPrice: '4900',
        offerCount: '3',
      },
    };
    extraHeadTags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  }

  const metrikaRaw = (process.env.VITE_YANDEX_METRIKA_ID || '').trim();
  if (/^\d{4,14}$/.test(metrikaRaw)) {
    extraHeadTags.push(
      `<script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${metrikaRaw},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});</script>`
    );
  }

  out = out.replace('</head>', `    ${extraHeadTags.join('\n    ')}\n  </head>`);
  return out;
}

// SEO endpoints: robots.txt and sitemap.xml
app.get('/robots.txt', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.type('text/plain; charset=utf-8').send(
    [
      'User-agent: *',
      'Allow: /',
      'Allow: /features',
      'Allow: /pricing',
      'Allow: /about',
      'Allow: /contacts',
      'Allow: /faq',
      'Allow: /demo',
      'Allow: /privacy',
      'Allow: /terms',
      'Allow: /register',
      'Disallow: /app',
      'Disallow: /app/',
      'Disallow: /api/',
      '',
      `Sitemap: ${baseUrl}/sitemap.xml`,
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const nowDate = new Date().toISOString().slice(0, 10);
  const publicPaths = [
    { path: '/', priority: '1.0', freq: 'weekly' },
    { path: '/features', priority: '0.9', freq: 'weekly' },
    { path: '/pricing', priority: '0.9', freq: 'weekly' },
    { path: '/demo', priority: '0.8', freq: 'weekly' },
    { path: '/register', priority: '0.8', freq: 'monthly' },
    { path: '/about', priority: '0.7', freq: 'monthly' },
    { path: '/faq', priority: '0.7', freq: 'monthly' },
    { path: '/contacts', priority: '0.7', freq: 'monthly' },
    { path: '/privacy', priority: '0.3', freq: 'yearly' },
    { path: '/terms', priority: '0.3', freq: 'yearly' },
  ];

  const urls = publicPaths
    .map(
      item =>
        `  <url>\n    <loc>${baseUrl}${item.path === '/' ? '' : item.path}</loc>\n    <lastmod>${nowDate}</lastmod>\n    <changefreq>${item.freq}</changefreq>\n    <priority>${item.priority}</priority>\n  </url>`
    )
    .join('\n');

  res
    .type('application/xml; charset=utf-8')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

app.get(['/site_beget.zip', '/app_bundle.zip', '/download'], (_req: Request, res: Response) => {
  const zipPath = path.resolve(process.cwd(), 'site_beget.zip');
  if (fs.existsSync(zipPath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="site_beget.zip"');
    return res.download(zipPath, 'site_beget.zip');
  }
  res.status(404).send('Archive file not found');
});

async function bootstrap() {
  try {
    await db.init();

    if (isDev) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);

      app.use('*', async (req: Request, res: Response, next: NextFunction) => {
        if (req.originalUrl.startsWith('/api')) {
          return next();
        }
        try {
          const indexHtmlPath = path.resolve(process.cwd(), 'index.html');
          if (!fs.existsSync(indexHtmlPath)) {
            return next();
          }
          let template = fs.readFileSync(indexHtmlPath, 'utf-8');
          template = await vite.transformIndexHtml(req.originalUrl, template);
          template = injectRouteSeoAndAnalytics(template, req);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (e) {
          next(e);
        }
      });
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir, { index: false }));
      app.get('*', (req: Request, res: Response, next: NextFunction) => {
        if (req.originalUrl.startsWith('/api')) {
          return next();
        }
        const indexPath = path.join(distDir, 'index.html');
        if (!fs.existsSync(indexPath)) {
          return res.status(404).send('App bundle not found');
        }
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        const seoHtml = injectRouteSeoAndAnalytics(rawHtml, req);
        res.status(200).set({ 'Content-Type': 'text/html' }).send(seoHtml);
      });
    }

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[Global Error Handler]:', err);
      const status = err.status || 500;
      const message = isDev ? err.message || 'Internal Server Error' : 'Внутренняя ошибка сервера';
      res.status(status).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message,
        },
      });
    });

    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[Server] SKLADIN Full-Stack server running on http://0.0.0.0:${port}`);
      schedulerService.start();
    });

    server.on('error', async (err: any) => {
      console.error('[Server] HTTP server error:', err?.message || err);
      schedulerService.stop();
      await db.close();
      process.exit(1);
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('[Server] Gracefully shutting down...');
      schedulerService.stop();
      server.close(async () => {
        await db.close();
        console.log('[Server] HTTP server and database closed.');
        process.exit(0);
      });
      setTimeout(async () => {
        await db.close();
        process.exit(0);
      }, 3000).unref();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('[Bootstrap Error]:', err);
    process.exit(1);
  }
}

bootstrap();
