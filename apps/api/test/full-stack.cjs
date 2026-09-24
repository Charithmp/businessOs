const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tag = randomUUID().slice(0,8);
  const email = `full-stack-${tag}@example.test`;
  const password = 'TestPassword123!';
  const salt = randomBytes(16).toString('hex');
  const ownerId = randomUUID();
  const organizationId = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[ownerId,email,`${salt}:${scryptSync(password,salt,64).toString('hex')}`]);
  await db.query("INSERT INTO organizations(id,type,name,slug) VALUES($1,'PLATFORM',$2,$3)",[organizationId,'Full Stack Test',`full-stack-${tag}`]);
  await db.query('INSERT INTO organization_members(organization_id,user_id,role_id) VALUES($1,$2,$3)',[organizationId,ownerId,'00000000-0000-4000-8000-000000000001']);
  const api = spawn(process.execPath,[resolve(__dirname,'../dist/main.js')],{cwd:resolve(__dirname,'..'),env:{...process.env,PORT:'3001'},stdio:'ignore'});
  const web = spawn(process.execPath,[resolve(__dirname,'../../web/node_modules/next/dist/bin/next'),'start','-p','3000'],{cwd:resolve(__dirname,'../../web'),env:process.env,stdio:'ignore'});
  async function ready(url) {
    for (let attempt=0;attempt<60;attempt++) {
      try { const result=await fetch(url); if(result.ok) return; } catch {}
      await new Promise((resolve)=>setTimeout(resolve,500));
    }
    throw new Error(`Service did not start: ${url}`);
  }
  try {
    await Promise.all([ready('http://127.0.0.1:3001/api/v1/health'),ready('http://127.0.0.1:3000/')]);
    const page = await fetch('http://127.0.0.1:3000/');
    assert.match(await page.text(),/Sign in/);
    const login = await fetch('http://127.0.0.1:3000/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(login.status,201);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const list = await fetch('http://127.0.0.1:3000/api/v1/organizations',{headers:{cookie}});
    assert.equal(list.status,200);
    assert.ok((await list.json()).some((organization)=>organization.id===organizationId));
    const selected = await fetch('http://127.0.0.1:3000/api/v1/organizations/switch',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({organizationId})});
    assert.equal(selected.status,201);
    const me = await fetch('http://127.0.0.1:3000/api/v1/me',{headers:{cookie}});
    assert.equal((await me.json()).organizationId,organizationId);
    console.log('Full-stack smoke passed: web page, API proxy, login cookie, organization list and switch');
  } finally {
    api.kill(); web.kill();
    await db.query('DELETE FROM sessions WHERE user_id=$1',[ownerId]);
    await db.query('DELETE FROM organization_members WHERE organization_id=$1',[organizationId]);
    await db.query('DELETE FROM organizations WHERE id=$1',[organizationId]);
    await db.query('DELETE FROM users WHERE id=$1',[ownerId]);
    await db.end();
  }
}
main().catch((error)=>{ console.error(error); process.exitCode=1; });
