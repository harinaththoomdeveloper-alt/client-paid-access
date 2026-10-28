-- Paid Client Access: schema, Row Level Security and payment functions.
-- Safe to run once on a fresh Supabase project (SQL Editor → paste → Run).

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

-- One row per portal client. id is the Supabase Auth user id (stable ID #1),
-- zoho_deal_id is the matching Zoho CRM Deal (stable ID #2).
create table public.clients (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  full_name     text not null,
  zoho_deal_id  text not null unique check (zoho_deal_id ~ '^[0-9]+$'),
  created_at    timestamptz not null default now()
);

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text not null default '',
  price_cents   integer not null check (price_cents > 0),
  currency      text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  storage_path  text not null,           -- path inside the private "documents" bucket; never exposed to the browser
  created_at    timestamptz not null default now()
);

-- Every Stripe event we have acted on. The primary key makes webhook
-- processing idempotent: a repeated event cannot be processed twice.
create table public.stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

create table public.purchases (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.clients (id) on delete restrict,
  document_id               uuid not null references public.documents (id) on delete restrict,
  stripe_session_id         text not null unique,
  stripe_payment_intent_id  text unique,
  amount_cents              integer not null check (amount_cents > 0),
  currency                  text not null,
  paid_at                   timestamptz not null default now(),
  refunded_at               timestamptz
);
create index purchases_client_id_idx on public.purchases (client_id);

-- Access rights. unique(client_id, document_id) guarantees one entitlement per
-- client per document, no matter how many webhooks or payments arrive.
create table public.entitlements (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  purchase_id  uuid not null references public.purchases (id) on delete cascade,
  granted_at   timestamptz not null default now(),
  unique (client_id, document_id)
);

-- Outbox for the Zoho CRM update. Created in the same transaction as the
-- entitlement, so access and the pending CRM update can never disagree.
create table public.crm_sync (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null unique references public.purchases (id) on delete cascade,
  client_id        uuid not null references public.clients (id) on delete cascade,
  zoho_deal_id     text not null,
  status           text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  attempts         integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,           -- set while a worker is calling Zoho, prevents double updates
  synced_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index crm_sync_due_idx on public.crm_sync (status, next_attempt_at);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- Browser (anon / authenticated): read-only, own rows only.
-- All writes happen on the server with the service role key.
-- ─────────────────────────────────────────────────────────────

alter table public.clients       enable row level security;
alter table public.documents     enable row level security;
alter table public.stripe_events enable row level security;
alter table public.purchases     enable row level security;
alter table public.entitlements  enable row level security;
alter table public.crm_sync      enable row level security;

-- Supabase grants everything to anon/authenticated by default; start from nothing.
revoke all on public.clients, public.documents, public.stripe_events,
              public.purchases, public.entitlements, public.crm_sync
  from anon, authenticated;

grant select on public.clients, public.purchases, public.entitlements to authenticated;
-- Column-level grants: storage_path and Zoho/locking internals stay server-only.
grant select (id, title, description, price_cents, currency) on public.documents to authenticated;
grant select (id, purchase_id, client_id, status, attempts, last_error, synced_at) on public.crm_sync to authenticated;
-- stripe_events: no grants, no policies → invisible to the browser.

create policy "clients: read own row" on public.clients
  for select to authenticated using (id = (select auth.uid()));

create policy "documents: catalogue readable when signed in" on public.documents
  for select to authenticated using (true);

create policy "purchases: read own" on public.purchases
  for select to authenticated using (client_id = (select auth.uid()));

create policy "entitlements: read own" on public.entitlements
  for select to authenticated using (client_id = (select auth.uid()));

create policy "crm_sync: read own" on public.crm_sync
  for select to authenticated using (client_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- Payment functions (server only)
-- ─────────────────────────────────────────────────────────────

-- Records a successful payment atomically: event id, purchase, entitlement
-- and pending CRM job all commit together or not at all.
create or replace function public.record_payment(
  p_event_id           text,
  p_event_type         text,
  p_session_id         text,
  p_payment_intent_id  text,
  p_client_id          uuid,
  p_document_id        uuid,
  p_amount_cents       integer,
  p_currency           text
)
returns table (outcome text, purchase_id uuid, crm_sync_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deal_id      text;
  v_purchase_id  uuid;
  v_sync_id      uuid;
begin
  -- 1. Same Stripe event delivered again → do nothing.
  insert into public.stripe_events (event_id, type) values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
  if not found then
    return query select 'duplicate_event'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 2. The Zoho Deal comes from our database, never from the webhook payload.
  select c.zoho_deal_id into v_deal_id from public.clients c where c.id = p_client_id;
  if v_deal_id is null then
    raise exception 'Unknown client %', p_client_id using errcode = 'P0002';
  end if;

  -- 3. Same checkout session seen via a different event → do nothing.
  insert into public.purchases (client_id, document_id, stripe_session_id, stripe_payment_intent_id, amount_cents, currency)
    values (p_client_id, p_document_id, p_session_id, p_payment_intent_id, p_amount_cents, p_currency)
    on conflict (stripe_session_id) do nothing
    returning id into v_purchase_id;
  if v_purchase_id is null then
    return query select 'duplicate_session'::text,
      (select p.id from public.purchases p where p.stripe_session_id = p_session_id), null::uuid;
    return;
  end if;

  -- 4. Client already has access (e.g. paid twice in two tabs) → keep the
  --    purchase for refund follow-up, but no second entitlement or CRM update.
  insert into public.entitlements (client_id, document_id, purchase_id)
    values (p_client_id, p_document_id, v_purchase_id)
    on conflict (client_id, document_id) do nothing;
  if not found then
    return query select 'already_entitled'::text, v_purchase_id, null::uuid;
    return;
  end if;

  insert into public.crm_sync (purchase_id, client_id, zoho_deal_id)
    values (v_purchase_id, p_client_id, v_deal_id)
    returning id into v_sync_id;

  return query select 'granted'::text, v_purchase_id, v_sync_id;
end;
$$;

-- Removes access when a payment is fully refunded.
create or replace function public.revoke_access_for_refund(
  p_event_id           text,
  p_event_type         text,
  p_payment_intent_id  text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase_id uuid;
begin
  insert into public.stripe_events (event_id, type) values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
  if not found then
    return 'duplicate_event';
  end if;

  update public.purchases set refunded_at = now()
    where stripe_payment_intent_id = p_payment_intent_id and refunded_at is null
    returning id into v_purchase_id;
  if v_purchase_id is null then
    return 'unknown_or_already_refunded';
  end if;

  delete from public.entitlements where purchase_id = v_purchase_id;
  return 'revoked';
end;
$$;

-- Claims a CRM job for one worker. Only one caller can hold the lock, so the
-- webhook, the background worker and the retry command never update Zoho twice.
create or replace function public.claim_crm_sync(p_id uuid, p_lock_seconds integer default 120)
returns setof public.crm_sync
language sql
security invoker
set search_path = ''
as $$
  update public.crm_sync
     set locked_until = now() + make_interval(secs => p_lock_seconds),
         attempts     = attempts + 1,
         updated_at   = now()
   where id = p_id
     and status <> 'synced'
     and (locked_until is null or locked_until < now())
  returning *;
$$;

-- Functions are callable via the API by default; restrict them to the server.
revoke execute on function public.record_payment(text, text, text, text, uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.revoke_access_for_refund(text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_crm_sync(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_payment(text, text, text, text, uuid, uuid, integer, text) to service_role;
grant execute on function public.revoke_access_for_refund(text, text, text) to service_role;
grant execute on function public.claim_crm_sync(uuid, integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- Storage: private bucket. No storage policies are created, so only the
-- server (service role) can read files and hand out short-lived signed URLs.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
