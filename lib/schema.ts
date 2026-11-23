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
`;

/** Tables in dependency order, children first, for wiping on Reset demo. */
export const TABLES_TO_WIPE = [
  "audit_log",
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
