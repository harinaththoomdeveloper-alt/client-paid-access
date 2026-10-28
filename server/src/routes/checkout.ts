import { Router, type Response } from 'express'
import { z } from 'zod'
import { appConfig } from '../config.js'
import { stripe } from '../lib/stripe.js'
import { db } from '../lib/supabase.js'
import { requireUser, type AuthedLocals } from '../middleware/auth.js'

export const checkoutRouter = Router()

const bodySchema = z.object({ documentId: z.uuid() })

checkoutRouter.post('/checkout', requireUser, async (req, res: Response<unknown, AuthedLocals>) => {
  const body = bodySchema.safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'documentId must be a valid id' })
  const { documentId } = body.data
  const clientId = res.locals.userId

  const [clientRes, docRes, existingRes] = await Promise.all([
    db().from('clients').select('id, email').eq('id', clientId).maybeSingle(),
    db().from('documents').select('id, title, price_cents, currency').eq('id', documentId).maybeSingle(),
    db().from('entitlements').select('id').eq('client_id', clientId).eq('document_id', documentId).maybeSingle(),
  ])
  for (const r of [clientRes, docRes, existingRes]) if (r.error) throw r.error
  const [client, doc, existing] = [clientRes.data, docRes.data, existingRes.data]
  if (!client) return res.status(403).json({ error: 'No client profile is linked to this login' })
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (existing) return res.status(409).json({ error: 'You already have access to this document' })

  const { FRONTEND_URL } = appConfig()
  // Same client + document within the same minute (double click, two tabs)
  // returns the same Checkout Session instead of creating a second one.
  const minute = Math.floor(Date.now() / 60_000)
  const session = await stripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          // Price comes from our database, never from the browser
          price_data: { currency: doc.currency, unit_amount: doc.price_cents, product_data: { name: doc.title } },
        },
      ],
      // Charge exactly the listed price/currency; Adaptive Pricing would convert it
      // (e.g. to INR) and the webhook's amount check must compare like with like
      adaptive_pricing: { enabled: false },
      client_reference_id: client.id,
      customer_email: client.email,
      metadata: { client_id: client.id, document_id: doc.id },
      payment_intent_data: { metadata: { client_id: client.id, document_id: doc.id } },
      success_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&document_id=${doc.id}`,
      cancel_url: `${FRONTEND_URL}/payment/cancel`,
      // Stripe's minimum; derived from the minute bucket so retries send identical params
      expires_at: (minute + 31) * 60,
    },
    { idempotencyKey: `checkout:${client.id}:${doc.id}:${minute}` },
  )

  if (!session.url) return res.status(502).json({ error: 'Stripe did not return a checkout URL' })
  res.json({ url: session.url })
})
