import { z } from 'zod'

// Each group is validated on first use, so scripts only need the variables
// they actually touch (e.g. `seed` needs Supabase but not Stripe or Zoho).
function section<T extends z.ZodRawShape>(name: string, shape: T) {
  let cached: z.infer<z.ZodObject<T>> | undefined
  return () => {
    if (cached) return cached
    const result = z.object(shape).safeParse(process.env)
    if (!result.success) {
      // Report variable names only, never values
      const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new Error(`Invalid ${name} configuration in server/.env:\n${issues}`)
    }
    cached = result.data
    return cached
  }
}

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true')

export const appConfig = section('app', {
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  ADMIN_API_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  CRM_SYNC_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  CRM_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
})

export const supabaseConfig = section('Supabase', {
  SUPABASE_URL: z.url(),
  // Legacy service_role JWT or new sb_secret_ key. Bypasses RLS: server only.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20)
    .refine((v) => !v.startsWith('sb_publishable_'), 'is the publishable key; use the secret (sb_secret_…) or service_role key'),
})

export const stripeConfig = section('Stripe', {
  // Refuse live keys: this project must only ever touch test data
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_test_/, 'must be a Stripe TEST key (sk_test_… or rk_test_…)'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
})

export const zohoConfig = section('Zoho', {
  ZOHO_ACCOUNTS_URL: z.url(),
  ZOHO_API_URL: z.url(),
  ZOHO_API_VERSION: z.string().regex(/^v\d+$/).default('v8'),
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_REFRESH_TOKEN: z.string().min(1),
  ZOHO_SIMULATE_FAILURE: bool,
})
