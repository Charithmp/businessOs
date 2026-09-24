const { Client } = require('pg');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12+ characters)');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query("SELECT 1 FROM organizations WHERE slug='platform' LIMIT 1");
    if (exists.rowCount) throw new Error('Platform already initialized');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
    const userId = randomUUID();
    const orgId = randomUUID();
    await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[userId,email,passwordHash]);
    await client.query("INSERT INTO organizations(id,type,name,slug) VALUES($1,'PLATFORM','Business OS','platform')",[orgId]);
    await client.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)',[orgId,userId,'00000000-0000-4000-8000-000000000001']);
    await client.query('COMMIT');
    console.log('Platform owner created');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exitCode=1; });
