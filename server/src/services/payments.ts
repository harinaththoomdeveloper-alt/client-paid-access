import type Stripe from 'stripe'
import { z } from 'zod'
import { log } from '../lib/logger.js'
import { db } from '../lib/supabase.js'
import { processCrmSync } from './crmSync.js'

const metadataSchema = z.object({ client_id: z.uuid(), document_id: z.uuid() })

// Handles a verified Stripe event. Throwing makes the webhook return 500 so
// Stripe retries; returning normally acknowledges the event.
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handlePaidSession(event, event.data.object)

    case 'checkout.session.async_payment_failed':
      log.warn('async payment failed; no access granted', { eventId: event.id, sessionId: event.data.object.id })
      return

    case 'charge.refunded':
      return handleRefund(event, event.data.object)

    default:
      log.info('ignored stripe event', { eventId: event.id, type: event.type })
  }
}

async function handlePaidSession(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const ctx = { eventId: event.id, type: event.type, sessionId: session.id }

  // Delayed payment methods complete checkout before money arrives; access
  // waits for checkout.session.async_payment_succeeded in that case.
  if (session.mode !== 'payment' || session.payment_status !== 'paid') {
    log.info('session not paid yet; waiting', { ...ctx, paymentStatus: session.payment_status })
    return
  }

  // Stable IDs were attached by our own /api/checkout and arrive inside a
  // signature-verified event, so they cannot be forged by the browser.
  const meta = metadataSchema.safeParse(session.metadata)
  if (!meta.success || session.client_reference_id !== meta.data.client_id) {
    log.error('paid session has missing or inconsistent client metadata; manual review needed', ctx)
    return // retrying will not fix it
  }
  const { client_id: clientId, document_id: documentId } = meta.data

  const { data: doc, error: docErr } = await db()
    .from('documents')
    .select('price_cents, currency')
    .eq('id', documentId)
    .maybeSingle()
  if (docErr) throw new Error(`loading document failed: ${docErr.message}`)
  if (!doc) {
    log.error('paid session references unknown document; manual review needed', { ...ctx, documentId })
    return
  }
  // Never grant access for less than the listed price
  if (session.amount_total !== doc.price_cents || session.currency !== doc.currency) {
    log.error('paid amount does not match document price; access not granted, manual review needed', {
      ...ctx,
      paid: session.amount_total,
      paidCurrency: session.currency,
      expected: doc.price_cents,
      expectedCurrency: doc.currency,
    })
    return
  }

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const { data, error } = await db().rpc('record_payment', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_session_id: session.id,
    p_payment_intent_id: paymentIntentId ?? null,
    p_client_id: clientId,
    p_document_id: documentId,
    p_amount_cents: session.amount_total,
    p_currency: session.currency,
  })
  // Includes "Unknown client": thrown so Stripe keeps retrying and the
  // failure stays visible in the Stripe dashboard until data is fixed.
  if (error) throw new Error(`record_payment failed: ${error.message}`)

  const result = (data as { outcome: string; purchase_id: string | null; crm_sync_id: string | null }[])[0]
  switch (result?.outcome) {
    case 'granted':
      log.info('access granted', { ...ctx, clientId, documentId, purchaseId: result.purchase_id })
      // Fire and forget: the webhook must answer Stripe quickly. If this fails
      // or the process dies, the background worker picks the job up.
      void processCrmSync(result.crm_sync_id!).catch((e) =>
        log.error('crm sync crashed; worker will retry', { crmSyncId: result.crm_sync_id, error: String(e) }),
      )
      return
    case 'already_entitled':
      log.warn('client paid again for a document they already own; refund recommended', {
        ...ctx,
        clientId,
        documentId,
        purchaseId: result.purchase_id,
      })
      return
    default:
      log.info('duplicate delivery ignored', { ...ctx, outcome: result?.outcome })
  }
}

async function handleRefund(event: Stripe.Event, charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!charge.refunded || !paymentIntentId) {
    log.info('partial refund; access kept', { eventId: event.id, chargeId: charge.id })
    return
  }
  const { data, error } = await db().rpc('revoke_access_for_refund', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_payment_intent_id: paymentIntentId,
  })
  if (error) throw new Error(`revoke_access_for_refund failed: ${error.message}`)
  log.info('refund processed', { eventId: event.id, paymentIntentId, outcome: data })
}
