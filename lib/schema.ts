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
