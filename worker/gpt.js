// server.js — FR only — Puppeteer 24+
// Flux A : Plus -> Envoyer un message (si disponible)
// Flux B : Se connecter -> Ajouter une note -> saisir (<=300) -> Envoyer
/*
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const CONTACTS_FILE = path.join(__dirname, 'contacts.json');
const COOKIES_FILE  = path.join(__dirname, 'cookies.json');

const MAX_PROFILES = 5;
const TEST_MODE    = true;   // false en prod
const DEBUG        = true;

const MIN_DELAY_MS = TEST_MODE ? 3000 : 30000;
const MAX_DELAY_MS = TEST_MODE ? 7000 : 90000;

// Libellés FR
const FR = {
  messageButtons: ['Message', 'Contacter'],
  moreButton:     ['Plus'],
  connectButtons: ['Se connecter'],
  addNote:        ['Ajouter une note'],
  send:           ['Envoyer'],
  sendMessageMenu: (name) => [
    `Envoyer un message à ${name}`,
    'Envoyer un message',
    'Message',
    'Contacter'
  ]
};

// ---------- Utils ----------
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
async function scrollToTop(page){ await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'})); await sleep(350); }

async function humanType(page, selector, text){
  await page.focus(selector);
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.innerText=''; }, selector);
  for (const ch of text){ await page.keyboard.type(ch); await sleep(rand(35,110)); }
}

// click robuste
async function robustClick(page, el){
  try { await el.click({delay:10}); return; } catch {}
  const box = await el.boundingBox();
  if (box){
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down(); await page.mouse.up(); return;
  }
  await page.evaluate(e=>e.click(), el);
}

// bouton/anchor par texte (exact puis "contient"), sans :has / XPath
async function findButtonByText(page, texts, scope){
  const h = await page.evaluateHandle((texts, scope) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return null;
    const nodes = Array.from(root.querySelectorAll('button,[role="button"],a'));
    const norm = s => (s || '').replace(/\s+/g,' ').trim().toLowerCase();
    const wanted = texts.map(t => norm(t));

    // 1) égalité stricte (préférée)
    let el = nodes.find(n => wanted.includes(norm(n.innerText)));
    if (el) return el;

    // 2) fallback "contient"
    el = nodes.find(n => {
      const t = norm(n.innerText);
      return t && wanted.some(w => t.includes(w));
    });
    if (el) return el;

    // 3) aria-label "contient"
    el = nodes.find(n => {
      const a = norm(n.getAttribute('aria-label'));
      return a && wanted.some(w => a.includes(w));
    });
    return el || null;
  }, texts, scope || null);
  return h.asElement();
}

// Bandeau d’actions
async function getActionsRoot(page){
  const h = await page.evaluateHandle(() =>
    document.querySelector('.pvs-profile-actions') ||
    document.querySelector('[data-test-id="profile-actions"]') ||
    document.querySelector('section.pv-top-card') || null
  );
  return h.asElement();
}

async function findMoreButton(page){
  const el = await findButtonByText(page, FR.moreButton, '.pvs-profile-actions');
  if (el) return el;
  return await findButtonByText(page, FR.moreButton, null);
}

async function findConnectButton(page){
  const el = await findButtonByText(page, FR.connectButtons, '.pvs-profile-actions');
  if (el) return el;
  return await findButtonByText(page, FR.connectButtons, null);
}

// ---------- Plus -> menu -> "Envoyer un message" ----------
async function openPlusMenu(page){
  await scrollToTop(page);
  const root = await getActionsRoot(page);
  if (!root) throw new Error('Bandeau d’actions introuvable');

  const plusBtn = await findMoreButton(page);
  if (!plusBtn) throw new Error('Bouton "Plus" introuvable');
  await plusBtn.evaluate(e=>e.scrollIntoView({block:'center'}));
  if (DEBUG) console.log('🧭 Click "Plus"…');
  await robustClick(page, plusBtn);

  await page.waitForFunction(() => {
    const dd = Array.from(document.querySelectorAll('.artdeco-dropdown__content'));
    return dd.some(el => el.offsetParent !== null);
  }, { timeout: 15000 });
}

async function clickMenuSendMessage(page, name){
  const h = await page.evaluateHandle((labels) => {
    const c = document.querySelector('.artdeco-dropdown__content');
    if (!c) return null;
    const norm = s => (s || '').replace(/\s+/g,' ').trim();
    const items = Array.from(c.querySelectorAll('button,a,[role="menuitem"],div'));
    for (const t of labels){
      const el = items.find(n => norm(n.textContent||'').includes(t));
      if (el) return el;
    }
    return null;
  }, FR.sendMessageMenu(name || ''));
  const el = await h.asElement();
  if (!el) return false;        // entrée absente => DM indisponible
  await robustClick(page, el);
  return true;
}

async function tryOpenComposer(page, name){
  await scrollToTop(page);
  // bouton direct Message/Contacter ?
  const direct = await findButtonByText(page, FR.messageButtons, '.pvs-profile-actions');
  if (direct){ await direct.evaluate(e=>e.scrollIntoView({block:'center'})); await robustClick(page, direct); }
  else {
    try { await openPlusMenu(page); } catch { return false; }
    const ok = await clickMenuSendMessage(page, name || '');
    if (!ok) return false;
  }

  const sel = 'div.msg-form__contenteditable, div[contenteditable="true"]';
  try { await page.waitForSelector(sel, { timeout:15000 }); return sel; }
  catch { return false; }
}

// ---------- Attente robuste du CHAMP de note ----------
async function waitForNoteField(page){
  // attend jusqu’à ce qu’un champ éditable apparaisse dans la modale (après "Ajouter une note")
  return await page.waitForFunction(() => {
    const root = document.querySelector('.artdeco-modal, .send-invite');
    if (!root || root.offsetParent === null) return null;

    const pick = () => {
      const list = [
        ...root.querySelectorAll('textarea'),
        ...root.querySelectorAll('[contenteditable="true"]'),
        ...root.querySelectorAll('[role="textbox"]'),
        ...root.querySelectorAll('div[aria-multiline="true"]'),
        ...root.querySelectorAll('input[type="text"]')
      ];
      // garde visibles
      const vis = list.filter(el => {
        const r = el.getBoundingClientRect?.();
        return el.offsetParent !== null || (r && r.width > 0 && r.height > 0);
      });
      return vis[0] || null;
    };

    return pick();
  }, { timeout: 15000, polling: 150 });
}

// ---------- Connect + Note ----------
async function connectWithNote(page, note){
  await scrollToTop(page);

  // 1) Se connecter
  const connectBtn = await findConnectButton(page);
  if (!connectBtn) throw new Error('Bouton "Se connecter" introuvable');
  await connectBtn.evaluate(e=>e.scrollIntoView({block:'center'}));
  if (DEBUG) console.log('🧭 Click "Se connecter"…');
  await robustClick(page, connectBtn);

  // 2) attendre la modale
  await page.waitForFunction(() => {
    const m = document.querySelector('.artdeco-modal, .send-invite');
    return m && m.offsetParent !== null;
  }, { timeout:15000 });

  // 3) Cliquer "Ajouter une note"
  let addClicked = false;
  for (let k=0;k<3 && !addClicked;k++){
    const addBtn = await findButtonByText(page, FR.addNote, '.artdeco-modal, .send-invite');
    if (addBtn) {
      if (DEBUG) console.log('📝 Click "Ajouter une note"...');
      await robustClick(page, addBtn);
      addClicked = true;
      await sleep(250);
    } else {
      // certains flux affichent directement la zone
      break;
    }
  }

  // 4) Attendre le champ de note (PRIMORDIAL)
  const fieldHandle = await waitForNoteField(page);
  if (!fieldHandle) throw new Error('Zone de note introuvable');

  // 5) Focus + saisie
  await fieldHandle.evaluate(e => e.focus());
  const msg = (note || '').slice(0,300);
  await page.keyboard.type(msg, { delay: 28 });

  // 6) Envoyer
  const sendBtn = await findButtonByText(page, FR.send, '.artdeco-modal, .send-invite');
  if (!sendBtn) throw new Error('Bouton "Envoyer" (invitation) introuvable');
  await robustClick(page, sendBtn);
  await sleep(800);
  return true;
}

// ---------- Auth ----------
async function ensureLoggedIn(page){
  await page.goto('https://www.linkedin.com/feed/', { waitUntil:'networkidle2', timeout:60000 }).catch(()=>{});
  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    throw new Error('Cookie invalide / redirection login/checkpoint');
  }
}

// ---------- Main ----------
(async () => {
  try { console.log('🧰 Puppeteer version:', require('puppeteer/package.json').version); } catch {}
  if (!fs.existsSync('debug')) fs.mkdirSync('debug');

  console.log('🔎 Lecture des contacts depuis', CONTACTS_FILE);
  if (!fs.existsSync(CONTACTS_FILE)) { console.error('❌ contacts.json introuvable'); process.exit(1); }
  const contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE,'utf8')).slice(0, MAX_PROFILES);
  if (!contacts.length) { console.error('❌ Aucun contact'); process.exit(1); }

  // cookies
  let cookies = [];
  if (fs.existsSync(COOKIES_FILE)) {
    try { cookies = JSON.parse(fs.readFileSync(COOKIES_FILE,'utf8')); console.log('✅ cookies.json chargé.'); }
    catch(e){ console.warn('⚠️ Erreur lecture cookies.json', e.message); }
  } else if (process.env.LI_AT) {
    cookies = [{ name:'li_at', value:process.env.LI_AT, domain:'.linkedin.com', path:'/', httpOnly:true, secure:true }];
    console.log('✅ Cookie li_at via LI_AT.');
  } else { console.error('⚠️ Pas de cookie (cookies.json ou LI_AT)'); process.exit(1); }

  const browser = await puppeteer.launch({
    headless:false, args:['--no-sandbox','--disable-setuid-sandbox'], defaultViewport:null, slowMo:10
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
  try { await page.setCookie(...cookies); } catch(e){ console.warn('⚠️ setCookie:', e.message); }
  await ensureLoggedIn(page);

  console.log('🚀 Connecté. Profils à traiter :', contacts.length);
  const results = [];

  for (let i=0;i<contacts.length;i++){
    const c = contacts[i];
    console.log(`\n🔁 [${i+1}/${contacts.length}] → ${c.name} - ${c.url}`);
    let success=false;

    for (let tries=1; !success && tries<=2; tries++){
      try{
        await page.goto(c.url, { waitUntil:'domcontentloaded', timeout:60000 });
        await scrollToTop(page);

        // A) Essai DM (Plus -> Envoyer un message si dispo)
        const editorSel = await tryOpenComposer(page, c.name);
        if (editorSel){
          const msg = c.message || `Bonjour ${c.name},\nRavi(e) d’échanger.`;
          await humanType(page, editorSel, msg);

          const sendSelectors = ['button.msg-form__send-button', 'button[aria-label="Envoyer"]'];
          let sent = false;
          for (const s of sendSelectors){
            const el = await page.$(s);
            if (el){ await robustClick(page, el); sent = true; break; }
          }
          if (!sent){ await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); }

          await sleep(800);
          await page.screenshot({path:`debug/sent-${i+1}.png`});
          results.push({ name:c.name, url:c.url, success:true, via:'message', ts:new Date().toISOString() });
          success = true;
          break;
        }

        // B) Pas de DM → Connect + Note
        console.log('ℹ️ Message indisponible → Connect + Note');
        const note = (c.message || `Bonjour ${c.name}, heureux(se) de vous ajouter à mon réseau.`).slice(0,300);
        await connectWithNote(page, note);
        await page.screenshot({path:`debug/connect-note-${i+1}.png`});
        results.push({ name:c.name, url:c.url, success:true, via:'connect_note', ts:new Date().toISOString() });
        success = true;
      } catch(err){
        console.error('❌', err.message);
        try {
          const html = await page.content();
          fs.writeFileSync(path.join('debug', `error-${i+1}-${Date.now()}.html`), html);
          await page.screenshot({path:`debug/error-${i+1}.png`});
        } catch {}
        if (tries<2){ console.log('↩️ Retry dans 3s…'); await sleep(3000); }
      }
    }

    const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
    console.log(`⏳ Pause ${Math.round(delay/1000)}s…`); await sleep(delay);
  }

  fs.writeFileSync(path.join(__dirname,'debug','results.json'), JSON.stringify(results,null,2));
  console.log('\n📋 Résumé -> debug/results.json');
  await browser.close();
})();
*/
// server.js — FR only — Puppeteer 24+
// Flux A : Plus -> Envoyer un message (si disponible)
// Flux B : Se connecter -> Ajouter une note -> saisir (<=300) -> Envoyer

// ====== MODE ======
const IS_API = process.env.API_MODE === '1';

// ====== CommonJS deps (unifiés) ======
const fs = require('fs');
const path = require('path');

const CONTACTS_FILE = path.join(__dirname, 'contacts.json');
const COOKIES_FILE  = path.join(__dirname, 'cookies.json');

const MAX_PROFILES = 5;
const TEST_MODE    = true;   // false en prod
const DEBUG        = true;

const MIN_DELAY_MS = TEST_MODE ? 3000 : 30000;
const MAX_DELAY_MS = TEST_MODE ? 7000 : 90000;

// Libellés FR
const FR = {
  messageButtons: ['Message', 'Contacter'],
  moreButton:     ['Plus'],
  connectButtons: ['Se connecter'],
  addNote:        ['Ajouter une note'],
  send:           ['Envoyer'],
  sendMessageMenu: (name) => [
    `Envoyer un message à ${name}`,
    'Envoyer un message',
    'Message',
    'Contacter'
  ]
};

// ---------- Utils ----------
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
async function scrollToTop(page){ await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'})); await sleep(350); }

async function humanType(page, selector, text){
  await page.focus(selector);
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.innerText=''; }, selector);
  for (const ch of text){ await page.keyboard.type(ch); await sleep(rand(35,110)); }
}

// click robuste
async function robustClick(page, el){
  try { await el.click({delay:10}); return; } catch {}
  const box = await el.boundingBox();
  if (box){
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down(); await page.mouse.up(); return;
  }
  await page.evaluate(e=>e.click(), el);
}

// bouton/anchor par texte (exact puis "contient"), sans :has / XPath
async function findButtonByText(page, texts, scope){
  const h = await page.evaluateHandle((texts, scope) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return null;
    const nodes = Array.from(root.querySelectorAll('button,[role="button"],a'));
    const norm = s => (s || '').replace(/\s+/g,' ').trim().toLowerCase();
    const wanted = texts.map(t => norm(t));

    // 1) égalité stricte
    let el = nodes.find(n => wanted.includes(norm(n.innerText)));
    if (el) return el;

    // 2) "contient"
    el = nodes.find(n => {
      const t = norm(n.innerText);
      return t && wanted.some(w => t.includes(w));
    });
    if (el) return el;

    // 3) aria-label "contient"
    el = nodes.find(n => {
      const a = norm(n.getAttribute('aria-label'));
      return a && wanted.some(w => a.includes(w));
    });
    return el || null;
  }, texts, scope || null);
  return h.asElement();
}

// Bandeau d’actions
async function getActionsRoot(page){
  const h = await page.evaluateHandle(() =>
    document.querySelector('.pvs-profile-actions') ||
    document.querySelector('[data-test-id="profile-actions"]') ||
    document.querySelector('section.pv-top-card') || null
  );
  return h.asElement();
}

async function findMoreButton(page){
  const el = await findButtonByText(page, FR.moreButton, '.pvs-profile-actions');
  if (el) return el;
  return await findButtonByText(page, FR.moreButton, null);
}

async function findConnectButton(page){
  const el = await findButtonByText(page, FR.connectButtons, '.pvs-profile-actions');
  if (el) return el;
  return await findButtonByText(page, FR.connectButtons, null);
}

// ---------- Plus -> menu -> "Envoyer un message" ----------
async function openPlusMenu(page){
  await scrollToTop(page);
  const root = await getActionsRoot(page);
  if (!root) throw new Error('Bandeau d’actions introuvable');

  const plusBtn = await findMoreButton(page);
  if (!plusBtn) throw new Error('Bouton "Plus" introuvable');
  await plusBtn.evaluate(e=>e.scrollIntoView({block:'center'}));
  if (DEBUG) console.log(' Click "Plus"…');
  await robustClick(page, plusBtn);

  await page.waitForFunction(() => {
    const dd = Array.from(document.querySelectorAll('.artdeco-dropdown__content'));
    return dd.some(el => el.offsetParent !== null);
  }, { timeout: 90000 });
}

async function clickMenuSendMessage(page, name){
  const h = await page.evaluateHandle((labels) => {
    const c = document.querySelector('.artdeco-dropdown__content');
    if (!c) return null;
    const norm = s => (s || '').replace(/\s+/g,' ').trim();
    const items = Array.from(c.querySelectorAll('button,a,[role="menuitem"],div'));
    for (const t of labels){
      const el = items.find(n => norm(n.textContent||'').includes(t));
      if (el) return el;
    }
    return null;
  }, FR.sendMessageMenu(name || ''));
  const el = await h.asElement();
  if (!el) return false;        // entrée absente => DM indisponible
  await robustClick(page, el);
  return true;
}

async function tryOpenComposer(page, name){
  await scrollToTop(page);
  // bouton direct Message/Contacter ?
  const direct = await findButtonByText(page, FR.messageButtons, '.pvs-profile-actions');
  if (direct){ await direct.evaluate(e=>e.scrollIntoView({block:'center'})); await robustClick(page, direct); }
  else {
    try { await openPlusMenu(page); } catch { return false; }
    const ok = await clickMenuSendMessage(page, name || '');
    if (!ok) return false;
  }

  const sel = 'div.msg-form__contenteditable, div[contenteditable="true"]';
  try { await page.waitForSelector(sel, { timeout:90000 }); return sel; }
  catch { return false; }
}

// ---------- Attente robuste du CHAMP de note ----------
async function waitForNoteField(page){
  // attend jusqu’à ce qu’un champ éditable apparaisse dans la modale (après "Ajouter une note")
  return await page.waitForFunction(() => {
    const root = document.querySelector('.artdeco-modal, .send-invite');
    if (!root || root.offsetParent === null) return null;

    const pick = () => {
      const list = [
        ...root.querySelectorAll('textarea'),
        ...root.querySelectorAll('[contenteditable="true"]'),
        ...root.querySelectorAll('[role="textbox"]'),
        ...root.querySelectorAll('div[aria-multiline="true"]'),
        ...root.querySelectorAll('input[type="text"]')
      ];
      // garde visibles
      const vis = list.filter(el => {
        const r = el.getBoundingClientRect?.();
        return el.offsetParent !== null || (r && r.width > 0 && r.height > 0);
      });
      return vis[0] || null;
    };

    return pick();
  }, { timeout: 90000, polling: 150 });
}

// ---------- Connect + Note ----------
async function connectWithNote(page, note){
  await scrollToTop(page);

  // 1) Se connecter
  const connectBtn = await findConnectButton(page);
  if (!connectBtn) throw new Error('Bouton "Se connecter" introuvable');
  await connectBtn.evaluate(e=>e.scrollIntoView({block:'center'}));
  if (DEBUG) console.log(' Click "Se connecter"…');
  await robustClick(page, connectBtn);

  // 2) attendre la modale
  await page.waitForFunction(() => {
    const m = document.querySelector('.artdeco-modal, .send-invite');
    return m && m.offsetParent !== null;
  }, { timeout:90000 });

  // 3) Cliquer "Ajouter une note"
  let addClicked = false;
  for (let k=0;k<3 && !addClicked;k++){
    const addBtn = await findButtonByText(page, FR.addNote, '.artdeco-modal, .send-invite');
    if (addBtn) {
      if (DEBUG) console.log(' Click "Ajouter une note"...');
      await robustClick(page, addBtn);
      addClicked = true;
      await sleep(250);
    } else {
      // certains flux affichent directement la zone
      break;
    }
  }

  // 4) Attendre le champ de note (PRIMORDIAL)
  const fieldHandle = await waitForNoteField(page);
  if (!fieldHandle) throw new Error('Zone de note introuvable');

  // 5) Focus + saisie
  await fieldHandle.evaluate(e => e.focus());
  const msg = (note || '').slice(0,300);
  await page.keyboard.type(msg, { delay: 28 });

  // 6) Envoyer
  const sendBtn = await findButtonByText(page, FR.send, '.artdeco-modal, .send-invite');
  if (!sendBtn) throw new Error('Bouton "Envoyer" (invitation) introuvable');
  await robustClick(page, sendBtn);
  await sleep(800);
  return true;
}

// ---------- Worker (Puppeteer) : exécuter seulement si PAS en mode API ----------
if (!IS_API) {
  const puppeteer = require('puppeteer');

  async function ensureLoggedIn(page){
    await page.goto('https://www.linkedin.com/feed/', { waitUntil:'networkidle2', timeout:60000 }).catch(()=>{});
    if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
      throw new Error('Cookie invalide / redirection login/checkpoint');
    }
  }

  (async () => {
    try { console.log(' Puppeteer version:', require('puppeteer/package.json').version); } catch {}
    if (!fs.existsSync('debug')) fs.mkdirSync('debug', { recursive: true });

    console.log(' Lecture des contacts depuis', CONTACTS_FILE);
    if (!fs.existsSync(CONTACTS_FILE)) { console.error(' contacts.json introuvable'); process.exit(1); }

    // ← supporte objet OU tableau
    const raw = JSON.parse(fs.readFileSync(CONTACTS_FILE,'utf8'));
    const contacts = (Array.isArray(raw) ? raw : [raw]).slice(0, MAX_PROFILES);
    if (!contacts.length) { console.error(' Aucun contact'); process.exit(1); }

    // cookies
    let cookies = [];
    if (fs.existsSync(COOKIES_FILE)) {
      try { cookies = JSON.parse(fs.readFileSync(COOKIES_FILE,'utf8')); console.log(' cookies.json chargé.'); }
      catch(e){ console.warn('⚠️ Erreur lecture cookies.json', e.message); }
    } else if (process.env.LI_AT) {
      cookies = [{ name:'li_at', value:process.env.LI_AT, domain:'.linkedin.com', path:'/', httpOnly:true, secure:true }];
      console.log(' Cookie li_at via LI_AT.');
    } else { console.error('⚠️ Pas de cookie (cookies.json ou LI_AT)'); process.exit(1); }

    const browser = await require('puppeteer').launch({
      headless:false,
      args:['--no-sandbox','--disable-setuid-sandbox'],
      defaultViewport:null,
      slowMo:10
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    try { await page.setCookie(...cookies); } catch(e){ console.warn('⚠️ setCookie:', e.message); }
    await ensureLoggedIn(page);

    console.log(' Connecté. Profils à traiter :', contacts.length);
    const results = [];

    for (let i=0;i<contacts.length;i++){
      const c = contacts[i];
      console.log(`\n🔁 [${i+1}/${contacts.length}] → ${c.name || ''} - ${c.url}`);
      let success=false;

      for (let tries=1; !success && tries<=2; tries++){
        try{
          await page.goto(c.url, { waitUntil:'domcontentloaded', timeout:60000 });
          await scrollToTop(page);

          // A) Essai DM (Plus -> Envoyer un message si dispo)
          const editorSel = await tryOpenComposer(page, c.name || '');
          if (editorSel){
            const msg = c.message || `Bonjour ${c.name || ''},\nRavi(e) d’échanger.`;
            await humanType(page, editorSel, msg);

            const sendSelectors = ['button.msg-form__send-button', 'button[aria-label="Envoyer"]'];
            let sent = false;
            for (const s of sendSelectors){
              const el = await page.$(s);
              if (el){ await robustClick(page, el); sent = true; break; }
            }
            if (!sent){ await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); }

            await sleep(800);
            await page.screenshot({path:`debug/sent-${i+1}.png`});
            results.push({ name:c.name, url:c.url, success:true, via:'message', ts:new Date().toISOString() });
            success = true;
            break;
          }

          // B) Pas de DM → Connect + Note
          console.log(' Message indisponible → Connect + Note');
          const note = (c.message || `Bonjour ${c.name || ''}, heureux(se) de vous ajouter à mon réseau.`).slice(0,300);
          await connectWithNote(page, note);
          await page.screenshot({path:`debug/connect-note-${i+1}.png`});
          results.push({ name:c.name, url:c.url, success:true, via:'connect_note', ts:new Date().toISOString() });
          success = true;
        } catch(err){
          console.error('❌', err.message);
          try {
            const html = await page.content();
            fs.writeFileSync(path.join('debug', `error-${i+1}-${Date.now()}.html`), html);
            await page.screenshot({path:`debug/error-${i+1}.png`});
          } catch {}
          if (tries<2){ console.log('↩️ Retry dans 3s…'); await sleep(3000); }
        }
      }

      const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
      console.log(` Pause ${Math.round(delay/1000)}s…`); await sleep(delay);
    }

    fs.writeFileSync(path.join(__dirname,'debug','results.json'), JSON.stringify(results,null,2));
    console.log('\n Résumé -> debug/results.json');
    await browser.close();
  })();
}

// ---------- API (Express) : seulement si API_MODE=1 ----------
if (IS_API) {
  const express = require('express');
  const cors = require('cors');
  const { nanoid } = require('nanoid');
  const { spawn } = require('child_process');

  const app = express();
  app.use(cors({ origin: 'http://localhost:5174' }));
  app.use(express.json({ limit: '1mb' }));

  const jobs = []; // en mémoire

  function writeContacts(profiles, message) {
    // Respecte ton format actuel (objet OU tableau).
    try {
      let shape = 'array';
      if (fs.existsSync(CONTACTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONTACTS_FILE,'utf-8'));
        shape = Array.isArray(data) ? 'array' : (typeof data === 'object' ? 'object' : 'array');
      }
      if (shape === 'object') {
        const obj = { name: 'User 1', url: profiles[0], message: message || '' };
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify(obj, null, 2));
      } else {
        const arr = profiles.slice(0,5).map((u,i)=>({ name:`User ${i+1}`, url:u, message: message || '' }));
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify(arr, null, 2));
      }
    } catch (e) {
      console.error('writeContacts error:', e.message);
    }
  }

  function spawnWorker(){
    // relance CE MÊME fichier sans API_MODE pour exécuter le worker
    const child = spawn(process.execPath, [__filename], {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, API_MODE: undefined }
    });
    child.on('error', (e)=>console.error('Spawn error:', e));
    return child;
  }

  app.get('/', (_req,res)=>res.send('API OK'));
  app.get('/api/health', (_req,res)=>res.json({ ok:true, ts:new Date().toISOString() }));

  app.post('/api/run-now', (req,res)=>{
    const { profiles=[], message='' } = req.body || {};
    if (!Array.isArray(profiles) || profiles.length===0) {
      return res.status(400).json({ error:'profiles[] requis' });
    }

    writeContacts(profiles, message);

    const job = {
      id: nanoid(8),
      status: 'running',
      createdAt: new Date().toISOString(),
      items: profiles.slice(0,5).map(u => ({ url:u, status:'queued', message }))
    };
    jobs.push(job);

    const child = spawnWorker();
    job.pid = child.pid;
    child.on('exit', (code)=>{
      job.status = code===0 ? 'done' : 'failed';
      job.items.forEach(it => { if (it.status==='queued') it.status = job.status==='done'?'done':'failed'; });
    });

    res.json({ jobId: job.id, queued: job.items.length });
  });

  app.get('/api/jobs', (_req,res)=>res.json(jobs));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, ()=>console.log(`API http://localhost:${PORT}`));
}
