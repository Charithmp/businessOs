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
      if (!response.ok) throw new Error('You do not have access to that organization');
      await load();
    } catch (cause) { setError(cause instanceof Error?cause.message:'Unable to switch organization'); }
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
    </section> : <form onSubmit={(event)=>void login(event)}>
      <h2>Sign in</h2>
      <label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required />
      <label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event)=>setPassword(event.target.value)} required />
      <button type="submit" disabled={busy}>Sign in</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
