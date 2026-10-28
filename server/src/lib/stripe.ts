import Stripe from 'stripe'
import { stripeConfig } from '../config.js'

let client: Stripe | undefined

export function stripe(): Stripe {
  client ??= new Stripe(stripeConfig().STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15_000 })
  return client
}
