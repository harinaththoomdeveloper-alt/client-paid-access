import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { appConfig } from '../config.js'
import { db } from '../lib/supabase.js'

export interface AuthedLocals {
  userId: string
}

// Verifies the Supabase access token with Supabase Auth (signature, expiry,
// revocation) and exposes the user id. Never trusts ids sent by the browser.
export async function requireUser(req: Request, res: Response<unknown, AuthedLocals>, next: NextFunction) {
  const token = req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return res.status(401).json({ error: 'Not signed in' })

  const { data, error } = await db().auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Session expired, please sign in again' })

  res.locals.userId = data.user.id
  next()
}

// Protects operator-only endpoints (CRM retry) with a long random token.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(req.header('x-admin-token') ?? '')
  const expected = Buffer.from(appConfig().ADMIN_API_TOKEN)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
