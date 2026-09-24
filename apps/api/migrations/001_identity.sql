CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES organizations(id),
  type text NOT NULL CHECK (type IN ('PLATFORM','AGENCY','BUSINESS')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  country text NOT NULL DEFAULT 'LK',
  timezone text NOT NULL DEFAULT 'Asia/Colombo',
  locale text NOT NULL DEFAULT 'en-LK',
  currency text NOT NULL DEFAULT 'LKR',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizations_parent_type_status_idx ON organizations(parent_id,type,status);
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id,permission_key)
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  organization_id uuid REFERENCES organizations(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS support_access (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON audit_logs(organization_id,created_at);
INSERT INTO permissions(key) VALUES
  ('organization.read'),('organization.create'),('organization.member.manage'),
  ('organization.support'),('organization.audit.read') ON CONFLICT DO NOTHING;
INSERT INTO roles(id,key) VALUES
  ('00000000-0000-4000-8000-000000000001','OWNER'),
  ('00000000-0000-4000-8000-000000000002','ADMIN'),
  ('00000000-0000-4000-8000-000000000003','MEMBER') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key) VALUES
  ('00000000-0000-4000-8000-000000000001','organization.read'),
  ('00000000-0000-4000-8000-000000000001','organization.create'),
  ('00000000-0000-4000-8000-000000000001','organization.member.manage'),
  ('00000000-0000-4000-8000-000000000001','organization.support'),
  ('00000000-0000-4000-8000-000000000001','organization.audit.read'),
  ('00000000-0000-4000-8000-000000000002','organization.read'),
  ('00000000-0000-4000-8000-000000000002','organization.member.manage'),
  ('00000000-0000-4000-8000-000000000003','organization.read') ON CONFLICT DO NOTHING;
