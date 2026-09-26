CREATE TABLE IF NOT EXISTS website_templates (
  id uuid PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL,
  tree jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS websites (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
  slug text NOT NULL UNIQUE, name text NOT NULL, draft_tree jsonb NOT NULL,
  draft_revision integer NOT NULL DEFAULT 1 CHECK(draft_revision>0), draft_source text NOT NULL DEFAULT 'TEMPLATE',
  published_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS websites_org_idx ON websites(organization_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS website_versions (
  id uuid PRIMARY KEY, website_id uuid NOT NULL REFERENCES websites(id), version integer NOT NULL CHECK(version>0),
  tree jsonb NOT NULL, source text NOT NULL, checksum text NOT NULL,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(website_id,version), UNIQUE(website_id,id)
);
ALTER TABLE websites ADD CONSTRAINT websites_published_version_fkey FOREIGN KEY (id,published_version_id)
  REFERENCES website_versions(website_id,id);
CREATE TABLE IF NOT EXISTS website_deployments (
  id uuid PRIMARY KEY, website_id uuid NOT NULL, version_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('PUBLISH','ROLLBACK')),
  status text NOT NULL CHECK(status IN ('READY','FAILED')),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id,version_id) REFERENCES website_versions(website_id,id)
);
CREATE INDEX IF NOT EXISTS website_deployments_site_idx ON website_deployments(website_id,created_at DESC);
CREATE TABLE IF NOT EXISTS website_domains (
  id uuid PRIMARY KEY, website_id uuid NOT NULL REFERENCES websites(id), organization_id uuid NOT NULL REFERENCES organizations(id),
  hostname text NOT NULL UNIQUE CHECK(hostname=lower(hostname)), verification_token text NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING_VERIFICATION','VERIFIED','SSL_PENDING','ACTIVE','SUSPENDED')),
  certificate_ref text, verified_at timestamptz, activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_domains_site_idx ON website_domains(website_id,status);

CREATE TABLE IF NOT EXISTS ai_model_routes (
  policy text PRIMARY KEY CHECK(policy IN ('CHEAP','BALANCED','PREMIUM','FAST')),
  provider text NOT NULL CHECK(provider IN ('OPENAI','ANTHROPIC','GEMINI','MOCK')),
  model text NOT NULL, input_cost_micros_per_1k integer NOT NULL CHECK(input_cost_micros_per_1k>=0),
  output_cost_micros_per_1k integer NOT NULL CHECK(output_cost_micros_per_1k>=0),
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  monthly_budget_micros bigint NOT NULL CHECK(monthly_budget_micros>=0),
  key_source text NOT NULL CHECK(key_source IN ('PLATFORM_MANAGED','BYO_KEY')),
  default_policy text NOT NULL CHECK(default_policy IN ('CHEAP','BALANCED','PREMIUM','FAST')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_credentials (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider text NOT NULL CHECK(provider IN ('OPENAI','ANTHROPIC','GEMINI')),
  ciphertext bytea NOT NULL, nonce bytea NOT NULL, auth_tag bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,provider)
);
CREATE TABLE IF NOT EXISTS ai_requests (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), website_id uuid NOT NULL REFERENCES websites(id),
  idempotency_key text NOT NULL, fingerprint text NOT NULL, policy text NOT NULL,
  provider text NOT NULL, model text NOT NULL, key_source text NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
  prompt_tokens integer, completion_tokens integer, latency_ms integer,
  reserved_cost_micros bigint NOT NULL DEFAULT 0, actual_cost_micros bigint,
  result_tree jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_requests_org_month_idx ON ai_requests(organization_id,created_at DESC,status);

INSERT INTO website_templates(id,key,name,description,tree) VALUES
('10000000-0000-4000-8000-000000000001','business-starter','Business Starter','A simple service-business home page',
 '{"pages":[{"id":"home","path":"/","title":"Home","components":[{"id":"hero","type":"Hero","props":{"heading":"Welcome to your business","body":"Introduce your services and what makes them special.","buttonText":"Contact us","buttonHref":"#contact"}},{"id":"services","type":"Text","props":{"heading":"Our services","body":"Describe the value you bring to customers."}},{"id":"contact","type":"Text","props":{"heading":"Contact","body":"Tell customers how to reach you."}}]}]}'),
('10000000-0000-4000-8000-000000000002','portfolio','Portfolio','A compact portfolio and contact site',
 '{"pages":[{"id":"home","path":"/","title":"Home","components":[{"id":"hero","type":"Hero","props":{"heading":"Your work, beautifully presented","body":"A clear introduction to your portfolio.","buttonText":"Explore work","buttonHref":"#work"}},{"id":"work","type":"Text","props":{"heading":"Selected work","body":"Highlight a few excellent projects."}}]}]}')
ON CONFLICT(key) DO NOTHING;
