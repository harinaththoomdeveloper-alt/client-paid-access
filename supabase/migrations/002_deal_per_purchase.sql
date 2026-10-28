-- One Zoho Deal per purchase instead of one shared Deal per client.
-- Run after 001_init.sql (SQL Editor → paste → Run), then `npm run seed` so
-- clients.zoho_account_id holds Zoho Account ids, then `npm run demo:reset -- --yes`.

-- clients: the stable Zoho id is now the client's Account; Deals are created per purchase.
alter table public.clients rename column zoho_deal_id to zoho_account_id;

-- crm_sync: the Account to create the Deal under, plus the Deal once created.
-- zoho_deal_id is saved right after creation so a retry never creates a second Deal.
alter table public.crm_sync rename column zoho_deal_id to zoho_account_id;
alter table public.crm_sync add column zoho_deal_id text unique check (zoho_deal_id ~ '^[0-9]+$');

-- Same as 001, reading the Account id instead of the Deal id.
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
  v_account_id   text;
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

  -- 2. The Zoho Account comes from our database, never from the webhook payload.
  select c.zoho_account_id into v_account_id from public.clients c where c.id = p_client_id;
  if v_account_id is null then
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
  --    purchase for refund follow-up, but no second entitlement or Deal.
  insert into public.entitlements (client_id, document_id, purchase_id)
    values (p_client_id, p_document_id, v_purchase_id)
    on conflict (client_id, document_id) do nothing;
  if not found then
    return query select 'already_entitled'::text, v_purchase_id, null::uuid;
    return;
  end if;

  insert into public.crm_sync (purchase_id, client_id, zoho_account_id)
    values (v_purchase_id, p_client_id, v_account_id)
    returning id into v_sync_id;

  return query select 'granted'::text, v_purchase_id, v_sync_id;
end;
$$;
