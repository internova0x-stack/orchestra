import type { Sql } from "./db.ts";

// The simulated bank's tables. Created on first use and on Reset demo, so nobody has to paste SQL
// into Supabase. Statements are idempotent: an existing table is left alone.
export const SCHEMA = /* sql */ `
create table if not exists businesses (
  id text primary key,
  name text not null,
  country text not null,
  registration_number text not null,
  verification_status text not null check (verification_status in ('incomplete','pending','approved','failed','blocked')),
  verification_reason text,
  verification_missing text,
  verification_submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists business_users (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  full_name text not null,
  first_name text not null,
  date_of_birth date not null,
  role text not null check (role in ('view_only','payment_rights'))
);

create table if not exists balances (
  business_id text not null references businesses(id) on delete cascade,
  currency text not null,
  amount numeric(18,2) not null,
  primary key (business_id, currency)
);

create table if not exists transfers (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  created_by text references business_users(id),
  recipient_name text not null,
  recipient_account text not null,
  recipient_bank text,
  recipient_country text,
  amount numeric(18,2) not null,
  currency text not null,
  route text not null,
  description text,
  status text not null check (status in ('pending','processing','successful','failed','reversed')),
  stage text,
  failure_reason text,
  sent_at timestamptz not null,
  completed_at timestamptz,
  history jsonb not null default '[]'
);

create table if not exists incoming_payments (
  id text primary key,
  business_id text references businesses(id) on delete cascade,
  payer_name text not null,
  payer_bank text,
  amount numeric(18,2) not null,
  currency text not null,
  reference text,
  status text not null check (status in ('credited','unallocated')),
  received_at timestamptz not null,
  credited_at timestamptz,
  intended_business_id text references businesses(id) on delete cascade
);

create table if not exists fees (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('fee','conversion')),
  description text not null,
  trigger text,
  transfer_id text,
  currency text not null,
  amount numeric(18,2) not null,
  from_currency text,
  from_amount numeric(18,2),
  to_currency text,
  to_amount numeric(18,2),
  rate numeric(18,6),
  charged_at timestamptz not null
);

create table if not exists restrictions (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  transfer_id text references transfers(id) on delete cascade,
  kind text not null check (kind in ('customer_fixable','review_hold')),
  customer_reason text,
  internal_reason text,
  created_at timestamptz not null
);

create table if not exists rules (
  id text primary key,
  category text not null,
  name text not null,
  kind text not null check (kind in ('answer','limit')),
  origin text not null check (origin in ('sourced','sample')),
  value text not null,
  unit text,
  source_url text,
  sort int not null default 0,
  updated_by text not null default 'Seed',
  updated_at timestamptz not null default now()
);

create table if not exists rule_changes (
  id bigserial primary key,
  rule_id text not null,
  old_value text,
  new_value text,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key,
  typing_user_id text references business_users(id) on delete set null,
  messages jsonb not null default '[]',
  verified_user_id text references business_users(id) on delete set null,
  verified_at timestamptz,
  failed_attempts int not null default 0,
  pending_identity_tool_id text,
  pending_results jsonb not null default '[]',
  last_activity timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists escalations (
  reference text primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  business_id text references businesses(id) on delete set null,
  user_id text references business_users(id) on delete set null,
  urgency text not null check (urgency in ('urgent','high','normal')),
  trigger text not null,
  summary jsonb not null,
  status text not null default 'open' check (status in ('open','approved','declined','resolved')),
  respond_by timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists proofs (
  reference text primary key,
  transfer_id text not null references transfers(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  business_id text not null references businesses(id) on delete cascade,
  details jsonb not null,
  created_at timestamptz not null default now(),
  unique (transfer_id)
);

create table if not exists recalls (
  reference text primary key,
  transfer_id text not null unique references transfers(id) on delete cascade,
  business_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  user_id text references business_users(id) on delete set null,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('requested','awaiting_approval','approved','declined')),
  escalation_reference text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table conversations add column if not exists pending_action jsonb;
alter table escalations add column if not exists action jsonb;
alter table escalations add column if not exists resolution text;
alter table escalations add column if not exists decided_at timestamptz;

-- Personal (retail) accounts sit beside the business ones (owner, Nov 23: build the remaining use cases).
alter table businesses add column if not exists kind text not null default 'business';
alter table businesses add column if not exists account_number text;
alter table businesses add column if not exists kyc_tier int;
alter table businesses alter column registration_number drop not null;
alter table business_users add column if not exists phone text;
alter table business_users add column if not exists email text;
alter table business_users add column if not exists login_locked text;
alter table conversations add column if not exists stronger_verified_at timestamptz;
alter table conversations add column if not exists pending_code jsonb;

-- Use cases 1 and 2: cards, card transactions and disputes.
create table if not exists cards (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  last4 text not null,
  status text not null check (status in ('active','frozen','replaced','expired')),
  currency text not null,
  daily_limit numeric(18,2),
  delivery_address text,
  created_at timestamptz not null default now()
);
create table if not exists transactions (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  card_id text references cards(id) on delete set null,
  descriptor text not null,
  merchant_name text,
  location text,
  channel text not null check (channel in ('card','POS','ATM','web','transfer')),
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('pending','settled','declined','reversed')),
  decline_reason text,
  at timestamptz not null
);
create table if not exists disputes (
  reference text primary key,
  transaction_id text not null unique references transactions(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  amount numeric(18,2) not null,
  currency text not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists card_replacements (
  reference text primary key,
  card_id text not null references cards(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  fee numeric(18,2) not null,
  currency text not null,
  created_at timestamptz not null default now()
);
create sequence if not exists dispute_seq start 7001;
create sequence if not exists replacement_seq start 3301;

-- Card controls (Tomi, Nov 23: "build 1 but give configuration ability"): the card's settings and who froze it.
alter table cards add column if not exists online_payments boolean not null default true;
alter table cards add column if not exists international_payments boolean not null default true;
alter table cards add column if not exists contactless boolean not null default true;
alter table cards add column if not exists frozen_by text;
create sequence if not exists card_change_seq start 4401;

-- AI usage per model call (Nov 23, billing) and conversations Alexis starts herself (proactive failure messages).
create table if not exists ai_usage (
  id bigserial primary key,
  conversation_id uuid references conversations(id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created on ai_usage (created_at);
alter table conversations add column if not exists origin text;
alter table conversations add column if not exists proactive jsonb;
-- Listen mode (Nov 23): a helpdesk ticket or mailbox thread Orchestra listens to (lib/listen.ts).
alter table conversations add column if not exists listen jsonb;
create index if not exists conversations_listen on conversations ((listen->>'source'), (listen->>'external_id'));
-- CRM connectors (Nov 23): settings per product (credentials are environment variables) and the sandbox's record of writes.
create table if not exists crm_connectors (
  kind text primary key,
  mode text not null default 'off' check (mode in ('off','sandbox','live')),
  write_back boolean not null default true,
  data_entry boolean not null default false,
  groups jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz
);
-- Connector health (Nov 23): the API page's "Needs attention".
alter table crm_connectors add column if not exists last_received_at timestamptz;
alter table crm_connectors add column if not exists last_ok_at timestamptz;
alter table crm_connectors add column if not exists last_error text;
alter table crm_connectors add column if not exists last_error_status int;
alter table crm_connectors add column if not exists last_error_at timestamptz;
alter table crm_connectors add column if not exists recent jsonb not null default '[]';
-- A bank connects its own helpdesk on the API page (Nov 23): the details it typed, encrypted (lib/crm/credentials.ts),
-- the account and the secret's last 4 for the screen, and the secret part of the connector's webhook address.
alter table crm_connectors add column if not exists credentials text;
alter table crm_connectors add column if not exists account text;
alter table crm_connectors add column if not exists secret_last4 text;
alter table crm_connectors add column if not exists webhook_token text;
alter table crm_connectors add column if not exists connected_by text;
alter table crm_connectors add column if not exists connected_at timestamptz;
-- The email channel (Nov 23): the bank's support address forwarded to Orchestra (Postmark inbound), replies sent from
-- that address once its domain's DNS records are in place. One row. Practice mode (no Postmark keys) records instead.
create table if not exists email_channel (
  id int primary key default 1 check (id = 1),
  address text,
  domain text,
  forward_hash text,
  forward_address text,
  inbound_secret text,
  base_url text,
  practice boolean not null default false,
  domain_id bigint,
  records jsonb not null default '[]',
  test_received_at timestamptz,
  test_from text,
  test_subject text,
  confirm_code text,
  confirm_link text,
  dns_checked_at timestamptz,
  dns_verified_at timestamptz,
  mode text not null default 'drafts' check (mode in ('drafts','replies')),
  live boolean not null default false,
  live_at timestamptz,
  connected_by text,
  updated_at timestamptz
);
create table if not exists email_practice_sent (
  id bigserial primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  sent_from text not null,
  sent_to text not null,
  subject text not null,
  body text not null,
  headers jsonb not null default '{}',
  sent_at timestamptz not null default now()
);
-- A payment company's checkouts (Nov 25): payments people made to merchants by Pay with Transfer, a dedicated
-- virtual account or a card, the payment company's refunds, and the interbank (NIBSS) status of transfers by
-- session ID, which the payment company checks and returns. A payer matched to one payment is that
-- conversation's payer_payment_id: the only record they may see.
create table if not exists checkout_payments (
  id text primary key,
  reference text not null,
  merchant_holder_id text not null references businesses(id) on delete cascade,
  channel text not null check (channel in ('pay_with_transfer','virtual_account','card')),
  amount_expected numeric,
  amount_received numeric,
  currency text not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  received_at timestamptz,
  status text not null check (status in ('successful','received_late','received_short','received_over','awaiting','failed_debited','duplicate','unmatched')),
  payer_email text,
  payer_card_last4 text,
  payer_account_last4 text,
  payer_bank text,
  session_id text,
  virtual_account_last4 text,
  notify_status text check (notify_status in ('delivered','failed','pending')),
  notify_attempts int not null default 0,
  notify_last_at timestamptz,
  review_hold boolean not null default false
);
create table if not exists checkout_refunds (
  id text primary key,
  payment_id text not null references checkout_payments(id) on delete cascade,
  amount numeric not null,
  status text not null check (status in ('processing','completed','failed')),
  arn text,
  started_at timestamptz not null,
  completed_at timestamptz,
  started_by text not null
);
create table if not exists nip_sessions (
  session_id text primary key,
  status text not null check (status in ('successful','pending','failed','reversed')),
  beneficiary_account_last4 text,
  at timestamptz,
  detail text
);
create sequence if not exists checkout_refund_seq start 7001;
alter table conversations add column if not exists payer_payment_id text;
alter table conversations add column if not exists email_from text;
alter table conversations add column if not exists email_thread jsonb not null default '[]';
alter table conversations add column if not exists email_link_token text;
alter table conversations add column if not exists email_link_expires timestamptz;
create index if not exists conversations_email_from on conversations (email_from) where email_from is not null;
create table if not exists crm_records (
  conversation_id uuid not null references conversations(id) on delete cascade,
  kind text not null,
  ticket_id text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, kind)
);
create table if not exists crm_sandbox_calls (
  id bigserial primary key,
  kind text not null,
  method text not null,
  path text not null,
  body jsonb,
  at timestamptz not null default now()
);

-- Smart routing (Nov 23): the team a handoff is routed to, who picked it up, and when it went overdue unattended.
alter table escalations add column if not exists team text;
alter table escalations add column if not exists assigned_to text;
alter table escalations add column if not exists assigned_at timestamptz;
alter table escalations add column if not exists overdue_at timestamptz;

-- Use cases 12, 9 and 11: card, POS, ATM and web payments, their reversals and (later) their timelines.
create table if not exists payments (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  channel text not null check (channel in ('card','POS','ATM','web')),
  merchant_name text not null,
  location text,
  terminal_bank text,
  processor text,
  card_last4 text,
  amount numeric(18,2) not null,
  currency text not null,
  outcome text not null check (outcome in ('successful','failed_debited','declined')),
  failure_detail text,
  at timestamptz not null
);
create table if not exists reversals (
  reference text primary key,
  payment_id text not null unique references payments(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('in_progress','completed','requested','awaiting_approval')),
  automatic boolean not null default false,
  breach boolean not null default false,
  requested_at timestamptz not null,
  completed_at timestamptz
);
create sequence if not exists reversal_seq start 8101;

-- Use case 5: fee waivers.
alter table fees add column if not exists waivable boolean not null default false;
create table if not exists waivers (
  reference text primary key,
  fee_id text not null unique references fees(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  amount numeric(18,2) not null,
  currency text not null,
  created_at timestamptz not null default now()
);
create sequence if not exists waiver_seq start 9201;

-- Use cases 9 and 11: each stage of a payment and who reported it.
create table if not exists payment_events (
  id bigserial primary key,
  payment_id text not null references payments(id) on delete cascade,
  stage text not null check (stage in ('authorization','capture','settlement','payout')),
  status text not null check (status in ('ok','failed')),
  detail text,
  reported_by text not null,
  at timestamptz not null
);

-- Use case 7: loans and deferral requests.
create table if not exists loans (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  product text not null,
  currency text not null,
  principal numeric(18,2) not null,
  balance numeric(18,2) not null,
  annual_rate numeric(6,3) not null,
  monthly_payment numeric(18,2) not null,
  next_due_at timestamptz not null,
  arrears numeric(18,2) not null default 0,
  status text not null check (status in ('current','in_arrears','default')),
  started_at timestamptz not null
);
create table if not exists deferral_requests (
  reference text primary key,
  loan_id text not null references loans(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  months int not null,
  status text not null default 'requested',
  decision_by timestamptz not null,
  created_at timestamptz not null default now()
);
create sequence if not exists deferral_seq start 4401;

-- Use case 8: merchant payouts and holds.
create table if not exists merchant_payouts (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  amount numeric(18,2) not null,
  currency text not null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('scheduled','paid','delayed','rejected','on_hold')),
  delay_reason text,
  sales numeric(18,2) not null,
  fees numeric(18,2) not null,
  refunds numeric(18,2) not null,
  disputes numeric(18,2) not null,
  paid_at timestamptz
);
create table if not exists merchant_holds (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  payout_id text references merchant_payouts(id) on delete cascade,
  amount numeric(18,2) not null,
  currency text not null,
  kind text not null check (kind in ('customer_fixable','review_hold')),
  customer_reason text,
  internal_reason text,
  created_at timestamptz not null
);

-- Use case 17: proactive status updates. Watches on open cases and the messages sent to customers.
create table if not exists case_watches (
  id bigserial primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  holder_id text not null references businesses(id) on delete cascade,
  user_id text references business_users(id) on delete set null,
  kind text not null check (kind in ('reversal','recall','dispute','deferral','case','verification')),
  reference text not null,
  label text not null,
  last_status text not null,
  expected_by timestamptz,
  late_notified boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, reference)
);
create table if not exists outbox (
  id bigserial primary key,
  holder_id text not null references businesses(id) on delete cascade,
  user_id text references business_users(id) on delete set null,
  watch_id bigint references case_watches(id) on delete cascade,
  channel text not null,
  sent_to text not null,
  body text not null,
  sent_at timestamptz not null default now()
);
alter table outbox add column if not exists conversation_id uuid references conversations(id) on delete set null;

-- Use case 18: claim and evidence packs for another bank, a processor or a card scheme.
create table if not exists claim_drafts (
  reference text primary key,
  kind text not null check (kind in ('recall','chargeback','settlement_query')),
  subject text not null,
  holder_id text not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  escalation_reference text,
  to_party text not null,
  draft jsonb not null,
  deadline timestamptz,
  status text not null default 'draft' check (status in ('draft','sent')),
  sent_by text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create sequence if not exists claim_seq start 6601;

-- Use case 19: staff mode. Staff sign in (simulated) as a support agent or a supervisor.
create table if not exists staff_users (
  id text primary key,
  name text not null,
  role text not null check (role in ('support_agent','supervisor'))
);
-- Console sign-in and roles (Nov 23, lib/auth.ts): accounts survive Reset demo.
alter table staff_users drop constraint if exists staff_users_role_check;
alter table staff_users add constraint staff_users_role_check check (role in ('support_agent','supervisor','operations_admin','compliance','management','it_admin'));
alter table staff_users add column if not exists email text;
alter table staff_users add column if not exists password_hash text;
alter table staff_users add column if not exists active boolean not null default true;
alter table staff_users add column if not exists must_change boolean not null default false;
alter table staff_users add column if not exists last_login_at timestamptz;
alter table staff_users add column if not exists demo boolean not null default false;
create unique index if not exists staff_users_email on staff_users (email);
create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id text not null references staff_users(id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists login_attempts (
  id bigserial primary key,
  email text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_email on login_attempts (email, at);
alter table conversations add column if not exists mode text not null default 'customer';
alter table conversations add column if not exists staff_id text;
alter table conversations add column if not exists case_reference text;

-- Use case 14: airtime, data and bill payments. Use case 16: USSD sessions and agent banking.
create table if not exists bill_payments (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  biller text not null,
  kind text not null check (kind in ('airtime','data','electricity','tv','water')),
  customer_ref text not null,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('delivered','pending','failed_at_provider','refunded')),
  token text,
  provider_ref text,
  at timestamptz not null,
  refund_reference text
);
create table if not exists ussd_sessions (
  id text primary key,
  holder_id text not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('ussd','agent')),
  code text,
  agent_name text,
  agent_id text,
  location text,
  action text not null,
  amount numeric(18,2) not null,
  currency text not null,
  outcome text not null,
  linked_ref text,
  at timestamptz not null
);
create sequence if not exists bill_refund_seq start 2201;

create sequence if not exists escalation_seq start 1042;
create sequence if not exists recall_seq start 5001;
create sequence if not exists proof_seq start 4101;
create sequence if not exists complaint_seq start 211;

create table if not exists audit_log (
  id bigserial primary key,
  conversation_id uuid,
  user_id text,
  tool_use_id text,
  kind text not null check (kind in ('identity','lookup','action','refusal','handoff','rule','approval','error','rule_edit')),
  tool text,
  summary text not null,
  input jsonb,
  result jsonb,
  refusal_reason text,
  approver text,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists audit_log_conversation on audit_log (conversation_id, id);
alter table audit_log add column if not exists staff text;

-- The console: a member of the team can take over a conversation and reply in person. While
-- taken_over_by is set, Alexis doesn't answer; her next turn starts after the hand back.
alter table conversations add column if not exists taken_over_by text;
alter table conversations add column if not exists taken_over_at timestamptz;

-- Which version of this schema the database has, so a new server process skips the DDL (and its table
-- locks) when nothing changed. Written by ensureSeeded after the schema runs.
create table if not exists app_meta (key text primary key, value text not null);

-- Rules management: changes wait for a supervisor's approval (a supervisor's own edit goes live at once),
-- keep their history, and can set a value for one market only (an override of the default value).
alter table rule_changes add column if not exists market text;
alter table rule_changes add column if not exists status text not null default 'live';
alter table rule_changes add column if not exists source text;
alter table rule_changes add column if not exists note text;
alter table rule_changes add column if not exists decided_by text;
alter table rule_changes add column if not exists decided_at timestamptz;
-- Policy uploads (Nov 23): which upload a proposal came from, its page, a big change (needs its own decision)
-- and a conflict (the document gives two values: [{value, quote, page}]; a person picks one).
alter table rule_changes add column if not exists upload_id text;
alter table rule_changes add column if not exists document text;
alter table rule_changes add column if not exists page text;
alter table rule_changes add column if not exists big boolean not null default false;
alter table rule_changes add column if not exists conflict jsonb;
-- Channels (Tomi, Nov 23: simulated email and WhatsApp): where the customer wrote from.
alter table conversations add column if not exists channel text not null default 'app';
alter table conversations add column if not exists email_subject text;

-- Operations (Nov 23): a conversation waiting for the team (Alexis switched off, or the AI service down),
-- the customer's language, and the team's review of a finished conversation.
alter table conversations add column if not exists awaiting_team text;
alter table conversations add column if not exists language text not null default 'en';
create table if not exists conversation_reviews (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  rating text not null check (rating in ('good','needs_work')),
  note text,
  reviewed_by text not null,
  reviewed_at timestamptz not null default now()
);

-- The Orchestra API (Nov 23, step 2): keys for systems that call Orchestra, webhooks Orchestra sends,
-- and the events banks push in. Configuration (keys, endpoints) survives Reset demo.
create table if not exists api_keys (
  id text primary key,
  name text not null,
  prefix text not null,
  hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists webhook_endpoints (
  id text primary key,
  url text not null,
  secret text not null,
  events text[] not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists webhook_deliveries (
  id bigserial primary key,
  endpoint_id text not null references webhook_endpoints(id) on delete cascade,
  event_id text not null,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts int not null default 0,
  last_status int,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists webhook_deliveries_recent on webhook_deliveries (created_at desc);
create table if not exists api_events_received (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  result jsonb
);
alter table conversations add column if not exists external_ref text;

create table if not exists rule_overrides (
  rule_id text not null references rules(id) on delete cascade,
  market text not null check (market in ('NG','UK','US')),
  value text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (rule_id, market)
);
`;

/** Tables in dependency order, children first, for wiping on Reset demo. */
export const TABLES_TO_WIPE = [
  "crm_sandbox_calls",
  "email_practice_sent",
  "checkout_refunds",
  "checkout_payments",
  "nip_sessions",
  "conversation_reviews",
  "rule_overrides",
  "audit_log",
  "ussd_sessions",
  "bill_payments",
  "claim_drafts",
  "outbox",
  "case_watches",
  "deferral_requests",
  "loans",
  "merchant_holds",
  "merchant_payouts",
  "payment_events",
  "waivers",
  "reversals",
  "payments",
  "disputes",
  "card_replacements",
  "transactions",
  "cards",
  "recalls",
  "proofs",
  "escalations",
  "conversations",
  "rule_changes",
  "rules",
  "restrictions",
  "fees",
  "incoming_payments",
  "transfers",
  "balances",
  "business_users",
  "businesses",
];

export async function ensureSchema(sql: Sql) {
  await sql.unsafe(SCHEMA);
}
