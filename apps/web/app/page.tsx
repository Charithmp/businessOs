'use client';

import { FormEvent, useEffect, useState } from 'react';

type Organization = { id: string; name: string; type: string; slug: string };
type Profile = { id: string; email: string; organizationId: string | null };

export default function Home() {
  const [profile,setProfile] = useState<Profile|null>(null);
  const [organizations,setOrganizations] = useState<Organization[]>([]);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [organizationName,setOrganizationName] = useState('');
  const [organizationSlug,setOrganizationSlug] = useState('');

  async function load() {
    const me = await fetch('/api/v1/me',{ credentials:'same-origin' });
    if (!me.ok) { setProfile(null); setOrganizations([]); return; }
    setProfile(await me.json());
    const list = await fetch('/api/v1/organizations',{ credentials:'same-origin' });
    if (list.ok) setOrganizations(await list.json());
  }
  useEffect(()=>{ void load(); },[]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/auth/login',{ method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password}) });
      if (!response.ok) throw new Error('Email or password is incorrect');
      setPassword(''); await load();
    } catch (cause) { setError(cause instanceof Error?cause.message:'Unable to sign in'); }
    finally { setBusy(false); }
  }
  async function switchOrganization(id: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/organizations/switch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:id})});
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? 'You do not have access to that organization');
      }
      await load();
    } catch (cause) { setError(cause instanceof Error?cause.message:'Unable to switch organization'); }
    finally { setBusy(false); }
  }
  async function createOrganization(type: 'AGENCY' | 'BUSINESS') {
    const parentId = profile?.organizationId;
    if (!parentId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentId, type, name: organizationName, slug: organizationSlug }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Unable to create ${type.toLowerCase()}`);
      }
      const created = await response.json() as Organization;
      const switched = await fetch('/api/v1/organizations/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: created.id }) });
      if (!switched.ok) throw new Error(`Created ${type.toLowerCase()}, but could not select it`);
      setOrganizationName(''); setOrganizationSlug('');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create organization'); }
    finally { setBusy(false); }
  }
  async function logout() { await fetch('/api/v1/auth/logout',{method:'POST'}); setProfile(null); setOrganizations([]); }

  return <main>
    <h1>Business OS</h1>
    {profile ? <section>
      <p>Signed in as {profile.email}</p>
      <label htmlFor="organization">Organization</label>
      <select id="organization" value={profile.organizationId ?? ''} onChange={(event)=>void switchOrganization(event.target.value)} disabled={busy}>
        <option value="" disabled>Select an organization</option>
        {organizations.map((organization)=><option value={organization.id} key={organization.id}>{organization.name} ({organization.type})</option>)}
      </select>
      <button onClick={()=>void logout()}>Sign out</button>
      <a href="/observability">Logs &amp; audit</a>
      <a href="/websites">Website builder</a>
      {(() => {
        const selected = organizations.find((organization) => organization.id === profile.organizationId);
        const nextType = selected?.type === 'PLATFORM' ? 'AGENCY' : selected?.type === 'AGENCY' ? 'BUSINESS' : null;
        if (!nextType) return null;
        return <section>
          <h2>Create {nextType === 'AGENCY' ? 'an agency' : 'a business'}</h2>
          <p>{nextType === 'AGENCY' ? 'Create an agency before creating businesses and websites.' : 'Create a business, then open Website builder.'}</p>
          <label htmlFor="organization-name">Name</label><input id="organization-name" value={organizationName} onChange={(event)=>setOrganizationName(event.target.value)} />
          <label htmlFor="organization-slug">Slug</label><input id="organization-slug" value={organizationSlug} onChange={(event)=>setOrganizationSlug(event.target.value)} placeholder="lowercase-name" />
          <button disabled={busy || !organizationName.trim() || !organizationSlug.trim()} onClick={()=>void createOrganization(nextType)}>Create {nextType.toLowerCase()}</button>
        </section>;
      })()}
    </section> : <form onSubmit={(event)=>void login(event)}>
      <h2>Sign in</h2>
      <label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required />
      <label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event)=>setPassword(event.target.value)} required />
      <button type="submit" disabled={busy}>Sign in</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
