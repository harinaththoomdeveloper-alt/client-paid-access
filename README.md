# Paid Client Access

A client pays for a sample document through **Stripe** test checkout. A verified webhook
grants access in **Supabase** and creates a paid **Zoho CRM** Deal for that purchase under
the client's Account. The portal
shows access and CRM sync status, and each client can only ever see their own data.

```
web/       React + TypeScript (Vite) portal: login, status, buy, open document
server/    Node + Express + TypeScript: checkout, Stripe webhook, Zoho sync, document links
supabase/  SQL migration: tables, Row Level Security, payment functions, private bucket
```

## How it works

```
Browser ──login / read own status──▶ Supabase (anon key + RLS: own rows only)
   │
   ├─ Buy ──▶ POST /api/checkout ──▶ Stripe Checkout (test)       price from DB, stable IDs in metadata
   │
Stripe ──▶ POST /api/webhook
             1. verify signature (rejects forged / replayed / live-mode events)
             2. check paid amount == document price
             3. record_payment() in ONE transaction:
                  stripe_events (dedupe) → purchases → entitlements → crm_sync = pending
             4. respond 200, then create Zoho Deal ──▶ synced  |  stays pending + retried
   │
   └─ Open ──▶ GET /api/documents/:id/url ──▶ checks entitlement ──▶ 60-second signed URL
```

**Stable IDs:** Supabase user id (`clients.id`) ↔ Zoho Account id (`clients.zoho_account_id`).
Checkout puts the client and document id in Stripe metadata; the webhook looks the Account up
in our database and never trusts a Zoho id from the request.

**One Deal per purchase** (standard CRM model: Account = client, Deal = one sale). Each paid
document creates a Deal under the client's Account:

```
Account: Client B (Portal Test)
  ├─ Deal: Client B - Sample Document       Closed Won   $49
  └─ Deal: Client B - Market Report 2026    Closed Won   $19
```

Deal fields: `Deal_Name = <client> - <document>`, `Account_Name`, `Amount`, `Stage = Closed Won`,
`Closing_Date = payment date`, `Payment_Status = Paid`, `Stripe_Session_ID = cs_test_…`, so one
ID traces the purchase across all three systems. The created Deal id is saved in
`crm_sync.zoho_deal_id`. Deals are created only after payment, so abandoned checkouts leave
nothing in Zoho.

## Setup

Prerequisites: Node 20+, [Stripe CLI](https://docs.stripe.com/stripe-cli), a Supabase project,
a Zoho CRM Developer Edition org, a Stripe account in test mode.

1. **Database:** paste `supabase/migrations/001_init.sql` into Supabase → SQL Editor → Run.
   Existing project created with 001 only: also run `supabase/migrations/002_deal_per_purchase.sql`.
2. **Zoho:** in Setup → Modules → Deals → Layouts, add two Single Line fields
   *Payment Status* and *Stripe Session ID*, and tick **Do not allow duplicate values** on
   *Stripe Session ID* (the Deal upsert relies on it so a retry never creates a second Deal).
   Create one Account per test client and put the Account ids in `server/seed/seed-data.ts`.
3. **Environment:**
   ```bash
   cp server/.env.example server/.env   # fill in Supabase, Stripe, Zoho values
   cp web/.env.example web/.env         # VITE_USE_MOCK=false + Supabase URL + anon key
   ```
4. **Zoho refresh token** (api-console.zoho.in or .com → Self Client → Generate Code, scope
   `ZohoCRM.modules.deals.ALL,ZohoCRM.settings.fields.READ`):
   ```bash
   cd server && npm run zoho:exchange-code -- <grant code>   # writes ZOHO_REFRESH_TOKEN, never prints it
   npm run zoho:check                                         # read-only: token, fields, deals
   ```
5. **Install, seed and run** (three terminals):
   ```bash
   cd server && npm install && npm run seed && npm run dev   # API on :4000
   cd web && npm install && npm run dev                      # portal on :5173
   stripe listen --forward-to localhost:4000/api/webhook \
     --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,charge.refunded
   ```
   Put the `whsec_…` printed by `stripe listen` into `STRIPE_WEBHOOK_SECRET` and restart the server.

Test logins: `demo@test.com` / `client-b@test.com`, password = `SEED_TEST_PASSWORD` in `server/.env`.
Test card: `4242 4242 4242 4242`, any future date, any CVC.

## Testing the important behaviour

| Scenario | How | Expected |
|---|---|---|
| Happy path | Buy as Client A | Portal: Access Granted, Payment Paid, CRM Synced. Zoho: new Deal "Client A - <document>", Closed Won, amount + session id |
| Second document | Buy another document as Client A | A second Deal under the same Account; the first is unchanged |
| Duplicate webhook | `stripe events resend <evt_id>` | Log `duplicate delivery ignored`; still 1 entitlement, no second Deal |
| Zoho down | `ZOHO_SIMULATE_FAILURE=true`, restart, buy as Client B | Access Granted, CRM **Pending** with error |
| Retry | set it back to `false`, restart, `npm run crm:retry` | CRM Synced, Deal created |
| Isolation | sign in as Client B | Client A's purchase is invisible; document URL request → 404 |
| Forged webhook | `curl -X POST localhost:4000/api/webhook -d '{}'` | 400 Invalid signature |
| Refund | refund the payment in the Stripe dashboard | Access removed, purchase shows Refunded |

Admin retry over HTTP: `POST /api/admin/crm/retry` with header `x-admin-token: $ADMIN_API_TOKEN`.

## Security

- Stripe and Zoho secrets and the Supabase service key exist only in `server/.env`; the browser
  holds only the Supabase URL and anon key. Live Stripe keys are rejected at startup.
- RLS on every table; the browser can only `select` its own rows, with column-level grants
  hiding `storage_path` and Zoho internals. `stripe_events` is invisible. Payment functions are
  executable by `service_role` only.
- Every API request verifies the Supabase JWT with Supabase Auth; user ids from the browser are
  never trusted. Price comes from the database, not the client.
- Documents live in a private bucket and are served through 60-second signed URLs after an
  entitlement check. Unknown and not-yours both return 404.
- helmet headers, CORS restricted to the portal origin, rate limiting, small body limits,
  constant-time admin token comparison, generic error messages, no secrets in logs.

## Edge cases handled

- **Duplicate / out-of-order webhooks:** event id primary key + unique session id; a session
  seen via `completed` and `async_payment_succeeded` is processed once.
- **Delayed payment methods:** access waits for `payment_status = paid`.
- **Double click / two tabs:** checkout idempotency key per client+document+minute; checkout
  refuses if access exists; a second real payment is recorded but grants nothing and is logged
  for refund; no second Deal is created.
- **Amount mismatch:** no access, logged for manual review.
- **Zoho down, slow, rate-limited, token expired:** 10s timeouts, token refresh with
  single-flight, transient vs permanent errors, exponential backoff (1→60 min), max attempts,
  background worker, manual retry. A lock (`claim_crm_sync`) prevents double updates.
- **Crash between DB commit and Zoho call:** job stays pending; the worker picks it up.
- **Crash after the Deal is created but before its id is saved:** the retry upserts on the
  unique `Stripe_Session_ID` and gets the same Deal back instead of creating a duplicate.
- **Unknown client in a paid event:** webhook returns 500 so Stripe keeps retrying and the
  failure is visible in the Stripe dashboard.
- **Full refund:** access revoked. Partial refunds keep access.

## Known limitations / next steps

- Refunds are not pushed to Zoho (the purchase's Deal stays Closed Won / Paid).
- Duplicate payments are flagged in logs, not auto-refunded.
- The worker runs in the API process; at scale it would be a separate job/queue.
- No automated test suite yet; behaviour is verified with the scenarios above.
- Zoho Deal field API names are assumed to be `Payment_Status` and `Stripe_Session_ID`;
  `npm run zoho:check` verifies them and that `Stripe_Session_ID` is unique. The token's scope
  covers Deals only, so Account ids are checked for format, not existence.
- Deal `Amount` is written in the org's currency; documents are priced in USD.
