CREATE TABLE IF NOT EXISTS crm_tenants (
  id uuid PRIMARY KEY, name text NOT NULL, public_slug text UNIQUE NOT NULL,
  default_assignee_id uuid, holidays jsonb NOT NULL DEFAULT '[]'
);
ALTER TABLE crm_tenants ADD COLUMN IF NOT EXISTS settings_version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS crm_users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id),
  name text NOT NULL, email text UNIQUE NOT NULL, role text NOT NULL CHECK (role IN ('admin','staff')),
  password_hash text NOT NULL, password_salt text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES crm_users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_cases (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id), assignee_id uuid NOT NULL,
  customer_type text NOT NULL CHECK(customer_type IN ('person','company')),
  name text NOT NULL, person text NOT NULL, phone text NOT NULL, email text NOT NULL,
  size text NOT NULL DEFAULT '', original jsonb NOT NULL,
  stage text NOT NULL DEFAULT '접수' CHECK(stage IN ('접수','상담 진행','제안·협의','계약 완료','서비스 진행','서비스 완료','종료')),
  received_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,assignee_id) REFERENCES crm_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_case_owner ON crm_cases(tenant_id,assignee_id,received_at);
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS request_memo text;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS deadline_policy jsonb;
CREATE TABLE IF NOT EXISTS crm_tasks (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, case_id uuid NOT NULL,
  title text NOT NULL, task_type text, description text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK(kind IN ('first','work')), status text NOT NULL DEFAULT 'incomplete' CHECK(status IN ('incomplete','complete')),
  due_at timestamptz, original_due_at timestamptz, excluded boolean NOT NULL DEFAULT false,
  completed_at timestamptz, completed_by uuid REFERENCES crm_users(id),
  created_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1,
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_one_first_contact ON crm_tasks(case_id) WHERE kind='first';
CREATE INDEX IF NOT EXISTS crm_task_due ON crm_tasks(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS crm_first_original_due ON crm_tasks(tenant_id,original_due_at) WHERE kind='first';
CREATE TABLE IF NOT EXISTS crm_notes (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, case_id uuid NOT NULL,
  body text NOT NULL, author_id uuid NOT NULL REFERENCES crm_users(id), created_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_contacts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, case_id uuid NOT NULL, task_id uuid NOT NULL REFERENCES crm_tasks(id),
  outcome text NOT NULL CHECK(outcome IN ('connected','sms','attempt')), actual_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL, actor_id uuid NOT NULL REFERENCES crm_users(id), memo text NOT NULL DEFAULT '',
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_audit (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, case_id uuid NOT NULL, actor_id uuid REFERENCES crm_users(id),
  action text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_contact_task_actual ON crm_contacts(task_id,actual_at,recorded_at DESC);
CREATE TABLE IF NOT EXISTS crm_idempotency (
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id), actor_scope text NOT NULL,
  operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,actor_scope,operation,key)
);
CREATE TABLE IF NOT EXISTS crm_change_proposals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, case_id uuid NOT NULL,
  type text NOT NULL CHECK(type IN ('close','service_complete','reassign')),
  reason text NOT NULL, proposed_assignee_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  case_version integer NOT NULL, version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES crm_users(id), created_at timestamptz NOT NULL,
  decided_by uuid REFERENCES crm_users(id), decided_at timestamptz,
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id),
  FOREIGN KEY(tenant_id,proposed_assignee_id) REFERENCES crm_users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_pending_proposals ON crm_change_proposals(tenant_id,case_id,status);
CREATE TABLE IF NOT EXISTS crm_notification_jobs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id), case_id uuid,
  recipient_id uuid REFERENCES crm_users(id), kind text NOT NULL CHECK(kind IN ('receipt','assignment','daily','first_reminder','review')),
  business_date date, dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','retry','reviewed','skipped','failed','blocked','unknown')),
  attempts integer NOT NULL DEFAULT 0, next_run timestamptz NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, reason text NOT NULL DEFAULT '',
  UNIQUE(tenant_id,dedupe_key), FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS crm_notification_due ON crm_notification_jobs(status,next_run);
CREATE TABLE IF NOT EXISTS crm_review_mail (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES crm_notification_jobs(id),
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id), recipient_id uuid REFERENCES crm_users(id),
  recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_runtime_state (
  name text PRIMARY KEY, last_tick timestamptz NOT NULL, error text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS crm_settings_history (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id),
  actor_id uuid NOT NULL REFERENCES crm_users(id), before_value jsonb NOT NULL, after_value jsonb NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_source_inquiries (
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id), source text NOT NULL,
  source_inquiry_id text NOT NULL, content_hash text NOT NULL, raw_payload jsonb NOT NULL,
  source_received_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL, case_id uuid NOT NULL,
  response jsonb NOT NULL, PRIMARY KEY(tenant_id,source,source_inquiry_id),
  FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_source_events (
  tenant_id uuid NOT NULL, source text NOT NULL, event_id text NOT NULL,
  source_inquiry_id text NOT NULL, event_hash text NOT NULL, received_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,source,event_id),
  FOREIGN KEY(tenant_id,source,source_inquiry_id) REFERENCES crm_source_inquiries(tenant_id,source,source_inquiry_id)
);
CREATE TABLE IF NOT EXISTS crm_change_cursors (
  tenant_id uuid PRIMARY KEY REFERENCES crm_tenants(id), revision bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_changes (
  tenant_id uuid NOT NULL, revision bigint NOT NULL, case_id uuid NOT NULL,
  previous_assignee_id uuid, created_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,revision), FOREIGN KEY(tenant_id,case_id) REFERENCES crm_cases(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS crm_recovery_state (
  tenant_id uuid PRIMARY KEY REFERENCES crm_tenants(id), cursor text,
  lease_id uuid, lease_until timestamptz, next_run timestamptz,
  status text NOT NULL DEFAULT 'idle', last_attempt timestamptz, last_success timestamptz,
  message text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS crm_recovery_errors (
  tenant_id uuid NOT NULL REFERENCES crm_tenants(id), item_key text NOT NULL,
  event_id text, source_inquiry_id text, status_code integer NOT NULL, message text NOT NULL,
  first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, resolved_at timestamptz,
  PRIMARY KEY(tenant_id,item_key)
);
CREATE TABLE IF NOT EXISTS crm_backups (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id),
  requested_by uuid NOT NULL REFERENCES crm_users(id), request_key text NOT NULL,
  reason text NOT NULL, status text NOT NULL CHECK(status IN ('creating','ready','failed')),
  filename text, counts jsonb, created_at timestamptz NOT NULL, verified_at timestamptz,
  message text NOT NULL DEFAULT '', UNIQUE(tenant_id,request_key)
);
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS crm_account_history (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES crm_tenants(id),
  user_id uuid NOT NULL REFERENCES crm_users(id), actor_id uuid NOT NULL REFERENCES crm_users(id),
  before_active boolean NOT NULL, after_active boolean NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL
);


ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS follow_up jsonb;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS linked_case_id uuid REFERENCES crm_cases(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS crm_cases_linked ON crm_cases(tenant_id,linked_case_id);
