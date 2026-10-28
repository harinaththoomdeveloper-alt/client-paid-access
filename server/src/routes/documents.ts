import { Router, type Response } from 'express'
import { z } from 'zod'
import { DOCUMENTS_BUCKET, db } from '../lib/supabase.js'
import { requireUser, type AuthedLocals } from '../middleware/auth.js'

export const documentsRouter = Router()

const SIGNED_URL_TTL_SECONDS = 60

documentsRouter.get('/documents/:id/url', requireUser, async (req, res: Response<unknown, AuthedLocals>) => {
  const id = z.uuid().safeParse(req.params.id)
  // Same 404 for "doesn't exist" and "not yours" so ids can't be probed
  const notFound = () => res.status(404).json({ error: 'Document not found' })
  if (!id.success) return notFound()

  // Service-role query, so the client filter here is what enforces ownership
  const { data: entitlement, error } = await db()
    .from('entitlements')
    .select('document_id, documents(storage_path)')
    .eq('client_id', res.locals.userId)
    .eq('document_id', id.data)
    .maybeSingle()
  if (error) throw error
  const doc = entitlement?.documents as unknown as { storage_path: string } | null
  if (!doc) return notFound()

  const { data: signed, error: signErr } = await db()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed) throw signErr ?? new Error('could not sign document url')

  res.setHeader('Cache-Control', 'no-store')
  res.json({ url: signed.signedUrl })
})
