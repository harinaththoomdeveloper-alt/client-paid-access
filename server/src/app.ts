import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { appConfig } from './config.js'
import { errorMessage, log } from './lib/logger.js'
import { adminRouter } from './routes/admin.js'
import { checkoutRouter } from './routes/checkout.js'
import { documentsRouter } from './routes/documents.js'
import { webhookRouter } from './routes/webhook.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())

  // Stripe calls the webhook server-to-server: no CORS, no rate limit, raw body
  app.use('/api', webhookRouter)

  app.use(cors({ origin: appConfig().FRONTEND_URL, allowedHeaders: ['Authorization', 'Content-Type'] }))
  app.use(express.json({ limit: '10kb' }))
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', checkoutRouter, documentsRouter, adminRouter)

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
  // Log details server-side, return a generic message to the client
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('unhandled request error', { error: errorMessage(err) })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  })
  return app
}
