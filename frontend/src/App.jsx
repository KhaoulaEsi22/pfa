import React, { useEffect, useMemo, useState } from 'react';

const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

async function http(path, opts = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function BackDecor() {
  const dots = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    id: i,
    top: Math.random() * 100,
    left: Math.random() * 100,
    opacity: 0.04 + Math.random() * 0.08
  })), []);
  return (
    <div style={{position:'absolute', inset:0, pointerEvents:'none', zIndex:0}}>
      {dots.map(d => (
        <div key={d.id}
             style={{
               position:'absolute', top:`${d.top}%`, left:`${d.left}%`,
               width:6, height:6, borderRadius:9999,
               background:'#fff', opacity:d.opacity, filter:'blur(2px)'
             }}/>
      ))}
    </div>
  );
}

export default function App(){
  const [token, setToken] = useState(localStorage.getItem('token')||'');
  const [email, setEmail] = useState('admin@iits.ma');
  const [password, setPassword] = useState('admin123');
  const [apiOk, setApiOk] = useState(null);
  const [tab, setTab] = useState('contacts'); // 'contacts' | 'calendar'

  // contacts
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ name:'', linkedin:'' });
  const [selection, setSelection] = useState({}); // id:true

  // calendrier local (pas de changement back)
  const LS_KEY = 'plannedJobs';
  const [planned, setPlanned] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });
  const [when, setWhen] = useState('');
  const [message, setMessage] = useState('');

  const now = new Date();
  const [{ y, m }, setYM] = useState({ y: now.getFullYear(), m: now.getMonth() });

  function savePlanned(arr){ localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

  function monthGrid(year, month){
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // Lundi
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      cells.push(d);
    }
    const label = first.toLocaleString('fr-FR',{ month:'long', year:'numeric' });
    return { cells, label };
  }
  const { cells, label } = monthGrid(y, m);

  async function ping(){ try{ await http('/api/health'); setApiOk(true);}catch{ setApiOk(false);} }
  async function loadContacts(){ try{ setContacts(await http('/api/contacts')); }catch{} }

  useEffect(()=>{ ping(); if(token){ loadContacts(); } },[token]);

  // “scheduler” front : toutes les 5s, lance /api/run-selected si une tâche arrive
  useEffect(()=>{
    if (!token) return;
    const t = setInterval(async ()=>{
      const data = (()=>{ try { return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); } catch { return []; } })();
      let changed = false;
      for (const e of data) {
        if (e.status === 'scheduled' && new Date(e.whenISO).getTime() <= Date.now()) {
          try {
            e.status = 'running'; changed = true; savePlanned(data); setPlanned([...data]);
            await http('/api/run-selected', { method:'POST', body: JSON.stringify({ ids:e.contactIds, message:e.message||'' }) });
            e.status = 'done'; changed = true;
          } catch {
            e.status = 'failed'; changed = true;
          }
        }
      }
      if (changed) { savePlanned(data); setPlanned([...data]); }
    }, 5000);
    return ()=>clearInterval(t);
  }, [token]);

  function logout(){ localStorage.removeItem('token'); setToken(''); }

  async function onLogin(e){
    e.preventDefault();
    try{
      const { token } = await http('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('token', token);
      setToken(token);
    }catch{ alert('Login invalide'); }
  }

  async function addContact(e){
    e.preventDefault();
    if (!form.linkedin) return alert('URL LinkedIn requise');
    try{
      await http('/api/contacts', { method:'POST', body: JSON.stringify(form) });
      setForm({ name:'', linkedin:'' });
      await loadContacts();
    }catch{ alert('Erreur création'); }
  }
  async function delContact(id){
    await http(`/api/contacts/${id}`, { method:'DELETE' });
    await loadContacts();
  }

  function selectedIds(){
    return Object.entries(selection).filter(([,v])=>v).map(([id])=>Number(id));
  }

  async function runSelectedNow(){
    const ids = selectedIds();
    if (!ids.length) return alert('Sélectionne au moins 1 contact');
    try{
      await http('/api/run-selected', { method:'POST', body: JSON.stringify({ ids, message }) });
      alert('Lot lancé');
    }catch{ alert('Erreur lancement'); }
  }

  function planInCalendar(e){
    e.preventDefault();
    const ids = selectedIds();
    if (!ids.length) return alert('Sélectionne au moins 1 contact');
    if (!when) return alert('Choisis date/heure');
    const newItem = {
      id: Math.random().toString(36).slice(2,10),
      whenISO: new Date(when).toISOString(),
      contactIds: ids,
      message,
      status: 'scheduled'
    };
    const next = [...planned, newItem];
    setPlanned(next); savePlanned(next);
    setTab('calendar');
  }
  function cancelPlanned(id){
    const next = planned.map(p => p.id===id ? { ...p, status:'canceled' } : p);
    setPlanned(next); savePlanned(next);
  }
  function eventsForDay(d){
    const ds = d.toDateString();
    return planned.filter(p => new Date(p.whenISO).toDateString() === ds);
  }

  /* ------------------- LOGIN ------------------- */
  if (!token){
    return (
      <div style={{minHeight:'100vh', display:'grid', gridTemplateColumns:'1fr 1fr', background:'#0b1220', color:'#e5e7eb', position:'relative', overflow:'hidden'}}>
        <BackDecor/>
        {/* IMPORTANT: l'image doit être dans /public/login.jpg */}
        <div style={{
          backgroundImage:"url('/login.jpg')",
          backgroundSize:'cover',
          backgroundPosition:'center',
          backgroundRepeat:'no-repeat'
        }}/>
        <div style={{display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:1}}>
          <form onSubmit={onLogin} style={{ width:400, background:'#111827', border:'1px solid #1f2937', borderRadius:16, padding:28 }}>
            <h2 className="h2">Connexion</h2>
            <div style={{marginBottom:12}}>
              <label>Email</label>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@iits.ma" className="input" />
            </div>
            <div style={{marginBottom:18}}>
              <label>Mot de passe</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" className="input" />
            </div>
            <button type="submit" className="btn">Se connecter</button>
            <div style={{marginTop:10, fontSize:12, color:'#94a3b8'}}>API : {apiOk===null?'…': apiOk?'OK':'KO'}</div>
          </form>
        </div>
      </div>
    );
  }

  /* ------------------- DASHBOARD ------------------- */
  return (
    <div style={{display:'flex', minHeight:'100vh', background:'#0b1220', color:'#e5e7eb', position:'relative', overflow:'hidden'}}>
      <BackDecor/>

      <aside style={{width:260, borderRight:'1px solid #1f2937', padding:16, position:'relative'}}>
        <div className="sidebar-profile">
          {/* IMPORTANT: ta photo doit être dans /public/profile.jpg */}
          <img src="/profile.jpg" alt="Profil" className="avatar"/>
          <div>
            <div className="brand">IITS — Prospection</div>
            <div className="muted">Puppeteer · React · Postgres</div>
          </div>
        </div>

        <div className="tabs">
          <button className={tab==='contacts'?'active':''} onClick={()=>setTab('contacts')}>Contacts</button>
          <button className={tab==='calendar'?'active':''} onClick={()=>setTab('calendar')}>Calendrier</button>
        </div>

        <div style={{fontSize:12, color: apiOk?'#10b981':'#f59e0b', marginTop:10}}>API : {apiOk?'OK':'KO'}</div>
        <button onClick={logout} className="btn secondary" style={{marginTop:16}}>Se déconnecter</button>
      </aside>

      <main style={{flex:1, padding:24}}>
        {/* Titres grands et gras */}
        <h1 className="h1">Tableau de bord</h1>

        {tab==='contacts' && (
          <div style={{display:'grid', gridTemplateColumns:'480px 1fr', gap:16}}>
            <div className="card">
              <h3 className="h3">Ajouter un contact</h3>
              <form onSubmit={addContact}>
                <div style={{marginBottom:8}}>
                  <label>Nom (facultatif)</label>
                  <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="input"/>
                </div>
                <div style={{marginBottom:12}}>
                  <label>URL LinkedIn</label>
                  <input value={form.linkedin} onChange={e=>setForm({...form, linkedin:e.target.value})} placeholder="https://www.linkedin.com/in/xxxxx/" className="input"/>
                </div>
                <button type="submit" className="btn">Ajouter</button>
              </form>
            </div>

            <div className="card">
              <h3 className="h3">Liste des contacts</h3>
              <div style={{maxHeight:420, overflow:'auto', border:'1px solid var(--border)', borderRadius:12}}>
                <table className="table">
                  <thead>
                    <tr><th>Sel.</th><th>Nom</th><th>URL</th><th>Créé le</th><th></th></tr>
                  </thead>
                  <tbody>
                  {contacts.map(c=>(
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={!!selection[c.id]} onChange={e=>setSelection({...selection, [c.id]:e.target.checked})}/></td>
                      <td>{c.name || '—'}</td>
                      <td><a href={c.linkedin} target="_blank" rel="noreferrer">{c.linkedin}</a></td>
                      <td>{new Date(c.createdAt).toLocaleString()}</td>
                      <td><button className="btn secondary" onClick={()=>delContact(c.id)}>Supprimer</button></td>
                    </tr>
                  ))}
                  {contacts.length===0 && <tr><td colSpan={5}>Aucun contact</td></tr>}
                  </tbody>
                </table>
              </div>

              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12}}>
                <button onClick={runSelectedNow} className="btn">Lancer maintenant</button>
                <button onClick={()=>setTab('calendar')} className="btn secondary">Planifier dans le calendrier →</button>
              </div>
            </div>

            <div className="card" style={{gridColumn:'1 / -1'}}>
              <h3 className="h3">Planifier depuis la sélection</h3>
              <form onSubmit={planInCalendar} style={{display:'grid', gridTemplateColumns:'260px 1fr 160px', gap:12}}>
                <input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} className="input"/>
                <input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Message facultatif" className="input"/>
                <button type="submit" className="btn">Ajouter au calendrier</button>
              </form>
            </div>
          </div>
        )}

        {tab==='calendar' && (
          <>
            <h1 className="h1" style={{marginTop:8}}>Calendrier</h1>

            <div className="calendar" style={{marginTop:8}}>
              <div className="cal-head">
                <button className="btn secondary" onClick={()=> setYM(({y,m}) => (m===0?{y:y-1,m:11}:{y,m:m-1}))}>←</button>
                <div style={{fontWeight:800}}>{label.toUpperCase()}</div>
                <button className="btn secondary" onClick={()=> setYM(({y,m}) => (m===11?{y:y+1,m:0}:{y,m:m+1}))}>→</button>
              </div>
              <div className="cal-grid">
                {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d=>(
                  <div key={d} className="cal-cell" style={{background:'#0e1526', minHeight:38, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center'}}>{d}</div>
                ))}
                {cells.map((d, idx) => {
                  const inMonth = d.getMonth() === m;
                  const evts = eventsForDay(d);
                  return (
                    <div key={idx} className="cal-cell" style={{ background: inMonth ? 'transparent' : 'rgba(255,255,255,.02)'}}>
                      <div className="cal-day">{d.getDate()}</div>
                      {evts.map(e => (
                        <div key={e.id} className="event">
                          {new Date(e.whenISO).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                          {' · '}
                          {e.status}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card" style={{marginTop:16}}>
              <h3 className="h3">Lots planifiés (navigateur)</h3>
              <div style={{maxHeight:280, overflow:'auto', border:'1px solid var(--border)', borderRadius:12}}>
                <table className="table">
                  <thead><tr><th>Quand</th><th>Statut</th><th>Contacts</th><th>Message</th><th></th></tr></thead>
                  <tbody>
                  {planned.sort((a,b)=>new Date(a.whenISO)-new Date(b.whenISO)).map(e=>(
                    <tr key={e.id}>
                      <td>{new Date(e.whenISO).toLocaleString()}</td>
                      <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                      <td>{e.contactIds.length}</td>
                      <td>{e.message || '—'}</td>
                      <td>{e.status==='scheduled' && <button className="btn secondary" onClick={()=>cancelPlanned(e.id)}>Annuler</button>}</td>
                    </tr>
                  ))}
                  {planned.length===0 && <tr><td colSpan={5}>Aucun lot planifié</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const inputStyle = {}; // on utilise .input via CSS global

