CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS features (
  id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), key text NOT NULL UNIQUE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS package_versions (
  id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES packages(id), version integer NOT NULL CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(package_id,version)
);
CREATE TABLE IF NOT EXISTS package_features (
  package_version_id uuid NOT NULL REFERENCES package_versions(id), feature_id uuid NOT NULL REFERENCES features(id),
  usage_limit integer CHECK(usage_limit IS NULL OR usage_limit >= 0), PRIMARY KEY(package_version_id,feature_id)
);
CREATE TABLE IF NOT EXISTS add_ons (
  id uuid PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS add_on_features (
  add_on_id uuid NOT NULL REFERENCES add_ons(id), feature_id uuid NOT NULL REFERENCES features(id),
  usage_limit integer CHECK(usage_limit IS NULL OR usage_limit >= 0), PRIMARY KEY(add_on_id,feature_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
  package_version_id uuid NOT NULL REFERENCES package_versions(id),
  status text NOT NULL CHECK(status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','EXPIRED')),
  trial_ends_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscription_add_ons (
  subscription_id uuid NOT NULL REFERENCES subscriptions(id), add_on_id uuid NOT NULL REFERENCES add_ons(id),
  PRIMARY KEY(subscription_id,add_on_id)
);
CREATE TABLE IF NOT EXISTS subscription_overrides (
  subscription_id uuid NOT NULL REFERENCES subscriptions(id), feature_id uuid NOT NULL REFERENCES features(id),
  enabled boolean NOT NULL, usage_limit integer CHECK(usage_limit IS NULL OR usage_limit >= 0),
  PRIMARY KEY(subscription_id,feature_id)
);
CREATE TABLE IF NOT EXISTS subscription_history (
  id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES subscriptions(id), actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, before_state jsonb, after_state jsonb NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_history_subscription_idx ON subscription_history(subscription_id,created_at);
CREATE TABLE IF NOT EXISTS usage_records (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), feature_id uuid NOT NULL REFERENCES features(id),
  quantity integer NOT NULL CHECK(quantity > 0), idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,feature_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS usage_records_scope_idx ON usage_records(organization_id,feature_id,created_at);
