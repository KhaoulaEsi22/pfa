import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();

const PORT        = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const JWT_SECRET  = process.env.JWT_SECRET || 'dev_secret';

// Répertoires pour le worker
const WORKER_DIR       = path.join(__dirname, '..', 'worker'); // ../worker
const WORKER_SCRIPT    = path.join(WORKER_DIR, 'gpt.js');
const WORKER_CONTACTS  = path.join(WORKER_DIR, 'contacts.json'); // fichier ÉPHÉMÈRE
const WORKER_COOKIES   = path.join(WORKER_DIR, 'cookies.json');  // session LI (si pas de LI_AT)

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Auth appli (JWT) 
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Utilisateur non trouvé' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe invalide' });

  const token = jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// CRUD Contacts (la table peut s’appeler Contact/prospect selon ton schéma)
// Ici on suppose Contact { id, name, linkedin, createdAt }

app.get('/api/prospects', auth, async (_req, res) => {
  const list = await prisma.contact.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(list);
});

app.post('/api/prospects', auth, async (req, res) => {
  const { name, url, linkedin, message } = req.body || {};
  // On accepte "url" ou "linkedin" depuis le front → on mappe vers la colonne "linkedin"
  const link = linkedin || url;
  if (!link) return res.status(400).json({ error: 'URL LinkedIn requise' });

  try {
    // Si ta table n’a pas "message", retire `message` ci-dessous
    const row = await prisma.contact.create({
      data: { name: name || null, linkedin: link /*, message: message || null*/ },
    });
    res.status(201).json(row);
  } catch (e) {
    // Doublon, etc.
    res.status(409).json({ error: 'Contact déjà existant' });
  }
});

app.delete('/api/prospects/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.contact.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
});
// Utilitaires Worker (écrit le contacts.json dans /worker puis lance gpt.js)

function writeContactsFile(rows, message) {
  // GPT.js attend un tableau : [{ name, url, message }]
  const arr = rows.map((r, i) => ({
    name: r.name || `User ${i + 1}`,
    url:  r.linkedin || r.url, // compat
    message: r.message || message || '',
  }));
  fs.writeFileSync(WORKER_CONTACTS, JSON.stringify(arr, null, 2), 'utf8');
}

function spawnWorker() {
  // Important : cwd = WORKER_DIR, pour que GPT.js lise worker/contacts.json et worker/cookies.json
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Si tu as LI_AT dans .env, GPT.js le prendra (sinon il utilisera cookies.json)
      // LI_AT: process.env.LI_AT || '',
    },
  });
  child.on('error', (e) => console.error('Spawn error:', e));
  return child;
}

app.post('/api/run-selected', auth, async (req, res) => {
  const { ids = [], message = '' } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids[] requis' });
  }

  // On lit en base les contacts sélectionnés
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids.map(Number) } },
  });

  if (rows.length === 0) return res.status(404).json({ error: 'Aucun contact trouvé' });

  // Écrit le fichier ÉPHÉMÈRE que GPT.js attend (source = DB)
  writeContactsFile(rows, message);

  // Lancer le worker
  const child = spawnWorker();

  // Ici, si tu as une table Job/JobItem, tu peux mettre à jour le statut en DB.
  // Minimal : on renvoie juste le nombre démarré.
  res.json({ started: rows.length, pid: child.pid });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: String(PORT), ts: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(` Backend lancé sur http://localhost:${PORT}`);
  console.log(`   Front autorisé : ${CORS_ORIGIN}`);
  console.log(`   Worker dir     : ${WORKER_DIR}`);
  console.log(`   cookies.json   : ${fs.existsSync(WORKER_COOKIES) ? 'présent' : 'absent'}`);
});
