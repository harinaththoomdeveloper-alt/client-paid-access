import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth.js'
import { retryCrmSyncs } from '../services/crmSync.js'

export const adminRouter = Router()

const bodySchema = z.object({ ids: z.array(z.uuid()).max(100).optional() })

// POST /api/admin/crm/retry   header: x-admin-token   body: { ids?: string[] }
adminRouter.post('/admin/crm/retry', requireAdmin, async (req, res) => {
  const body = bodySchema.safeParse(req.body ?? {})
  if (!body.success) return res.status(400).json({ error: 'ids must be an array of crm_sync ids' })
  res.json({ results: await retryCrmSyncs(body.data.ids) })
})
