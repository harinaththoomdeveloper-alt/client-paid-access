import express, { Router } from 'express'
import type Stripe from 'stripe'
import { stripeConfig } from '../config.js'
import { errorMessage, log } from '../lib/logger.js'
import { stripe } from '../lib/stripe.js'
import { handleStripeEvent } from '../services/payments.js'

export const webhookRouter = Router()

// Signature verification needs the exact raw bytes Stripe sent, so this route
// uses express.raw and is mounted before the global JSON parser.
webhookRouter.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const signature = req.header('stripe-signature')
  if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Missing signature' })

  let event: Stripe.Event
  try {
    // Also rejects replays: the signed timestamp must be within 5 minutes
    event = stripe().webhooks.constructEvent(req.body, signature, stripeConfig().STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    log.warn('rejected webhook with invalid signature', { error: errorMessage(e) })
    return res.status(400).json({ error: 'Invalid signature' })
  }

  // Test data only: acknowledge but never act on live-mode events
  if (event.livemode) {
    log.error('live-mode event received and ignored', { eventId: event.id, type: event.type })
    return res.json({ received: true })
  }

  try {
    await handleStripeEvent(event)
    res.json({ received: true })
  } catch (e) {
    log.error('webhook processing failed; Stripe will retry', { eventId: event.id, type: event.type, error: errorMessage(e) })
    res.status(500).json({ error: 'Processing failed' })
  }
})
