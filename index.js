const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'immo3d-ci-secret-2025';

// ── CORS ─────────────────────────────────────────
app.use(cors({
  origin: ['https://deblei.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// ── PostgreSQL ────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = {
  async query(sql, params = []) {
    const client = await pool.connect();
    try {
      const res = await client.query(sql, params);
      return res;
    } finally {
      client.release();
    }
  },
  async get(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows[0] || null;
  },
  async all(sql, params = []) {
    const res = await this.query(sql, params);
    return res.rows;
  },
  async run(sql, params = []) {
    return this.query(sql, params);
  }
};

// ── Multer uploads ────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.uploadSubDir || '');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadsDir));

// ── Init DB ───────────────────────────────────────
async function initDB() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'visiteur',
      telephone TEXT,
      agence TEXT,
      avatar TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      plan TEXT DEFAULT 'starter'
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS biens (
      id TEXT PRIMARY KEY,
      titre TEXT NOT NULL,
      type TEXT NOT NULL,
      type_transaction TEXT NOT NULL,
      prix BIGINT NOT NULL,
      surface INTEGER,
      chambres INTEGER DEFAULT 0,
      sdb INTEGER DEFAULT 0,
      quartier TEXT NOT NULL,
      commune TEXT NOT NULL,
      adresse TEXT,
      description TEXT,
      equipements TEXT DEFAULT '[]',
      statut TEXT DEFAULT 'brouillon',
      has_3d INTEGER DEFAULT 0,
      scan_status TEXT DEFAULT 'none',
      photos TEXT DEFAULT '[]',
      photos_360 TEXT DEFAULT '[]',
      agent_id TEXT NOT NULL,
      vues INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      bien_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      visiteur_nom TEXT NOT NULL,
      visiteur_email TEXT,
      visiteur_tel TEXT,
      message TEXT,
      type TEXT DEFAULT 'message',
      statut TEXT DEFAULT 'nouveau',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS favoris (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bien_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, bien_id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS alertes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      criteres TEXT NOT NULL,
      actif INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS visites_historique (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      bien_id TEXT NOT NULL,
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Seed si vide
  const count = await db.get('SELECT COUNT(*) as n FROM users');
  if (parseInt(count.n) === 0) await seedDemo();

  console.log('✅ Base de données PostgreSQL initialisée');
}

async function seedDemo() {
  const agentPwd = await bcrypt.hash('demo1234', 10);
  const visiteurPwd = await bcrypt.hash('demo1234', 10);
  const agentId = uuidv4();
  const visiteurId = uuidv4();

  await db.run(
    `INSERT INTO users (id,email,password,nom,prenom,role,telephone,agence,plan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [agentId, 'agent@immo3d.ci', agentPwd, 'Adjoua', 'Kouamé', 'agent', '+225 07 00 00 00 00', 'Prestige Immo Abidjan', 'premium']
  );
  await db.run(
    `INSERT INTO users (id,email,password,nom,prenom,role,telephone,plan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [visiteurId, 'visiteur@immo3d.ci', visiteurPwd, 'Koné', 'Aya', 'visiteur', '+225 05 00 00 00 00', 'free']
  );

  const biens = [
    { titre:'Villa moderne avec piscine', type:'villa', trans:'vente', prix:85000000, surf:320, ch:5, sdb:3, q:'Cocody', desc:'Magnifique villa de standing avec jardin tropical, piscine et vue dégagée.', equip:['Piscine','Garage x2','Groupe électrogène','Climatisation'], has3d:1 },
    { titre:'Appartement 4P — Le Plateau', type:'appartement', trans:'location', prix:350000, surf:95, ch:3, sdb:2, q:'Plateau', desc:'Appartement de 95m² au cœur du Plateau, vue mer.', equip:['Climatisation','Sécurité 24/7','Parking'], has3d:1 },
    { titre:'Duplex avec jardin — Bingerville', type:'duplex', trans:'vente', prix:42000000, surf:180, ch:4, sdb:2, q:'Bingerville', desc:'Duplex familial avec beau jardin arboré.', equip:['Jardin','Groupe électrogène'], has3d:1 },
    { titre:'Studio meublé — Marcory', type:'studio', trans:'location', prix:120000, surf:38, ch:1, sdb:1, q:'Marcory', desc:'Studio entièrement meublé et équipé.', equip:['Meublé','Climatisation'], has3d:1 },
    { titre:'Bureau open space — 2 Plateaux', type:'bureau', trans:'location', prix:480000, surf:140, ch:4, sdb:2, q:'2 Plateaux', desc:'Plateau de bureaux moderne, Internet très haut débit.', equip:['Internet fibre','Climatisation'], has3d:0 },
    { titre:'Villa contemporaine — Angré', type:'villa', trans:'vente', prix:60000000, surf:250, ch:4, sdb:3, q:'Angré', desc:'Architecture contemporaine épurée, finitions haut de gamme.', equip:['Piscine','Garage','Domotique'], has3d:1 },
  ];

  for (const b of biens) {
    await db.run(
      `INSERT INTO biens (id,titre,type,type_transaction,prix,surface,chambres,sdb,quartier,commune,description,equipements,statut,has_3d,scan_status,agent_id,vues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [uuidv4(), b.titre, b.type, b.trans, b.prix, b.surf, b.ch, b.sdb, b.q, 'Abidjan', b.desc,
       JSON.stringify(b.equip), 'actif', b.has3d, b.has3d?'done':'none', agentId, Math.floor(Math.random()*500)+100]
    );
  }
  console.log('✅ Données de démo créées');
}

// ── Helpers ───────────────────────────────────────
function parseBien(b) {
  if (!b) return null;
  return {
    ...b,
    transaction: b.type_transaction,
    equipements: typeof b.equipements === 'string' ? JSON.parse(b.equipements || '[]') : (b.equipements || []),
    photos: typeof b.photos === 'string' ? JSON.parse(b.photos || '[]') : (b.photos || []),
    photos_360: typeof b.photos_360 === 'string' ? JSON.parse(b.photos_360 || '[]') : (b.photos_360 || []),
  };
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

function agentOnly(req, res, next) {
  if (req.user.role !== 'agent') return res.status(403).json({ error: 'Réservé aux agents' });
  next();
}

// ════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nom, prenom, role, telephone, agence } = req.body;
    if (!email || !password || !nom || !prenom) return res.status(400).json({ error: 'Champs manquants' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });
    const exists = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.run(
      'INSERT INTO users (id,email,password,nom,prenom,role,telephone,agence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, email.toLowerCase(), hash, nom, prenom, role||'visiteur', telephone||null, agence||null]
    );
    const token = jwt.sign({ id, email, role: role||'visiteur', nom, prenom }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, email, nom, prenom, role: role||'visiteur', agence } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, nom: user.nom, prenom: user.prenom }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userSafe } = user;
    res.json({ token, user: userSafe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = await db.get('SELECT id,email,nom,prenom,role,telephone,agence,avatar,plan,created_at FROM users WHERE id = $1', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  res.json(user);
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  const { nom, prenom, telephone, agence } = req.body;
  await db.run('UPDATE users SET nom=$1,prenom=$2,telephone=$3,agence=$4 WHERE id=$5', [nom, prenom, telephone, agence, req.user.id]);
  res.json({ success: true });
});

app.put('/api/auth/password', authMiddleware, async (req, res) => {
  try {
    const { current, nouveau } = req.body;
    const user = await db.get('SELECT password FROM users WHERE id=$1', [req.user.id]);
    const ok = await bcrypt.compare(current, user.password);
    if (!ok) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    const hash = await bcrypt.hash(nouveau, 10);
    await db.run('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/avatar', authMiddleware, (req, res, next) => {
  req.uploadSubDir = 'avatars'; next();
}, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const url = `/uploads/avatars/${req.file.filename}`;
  await db.run('UPDATE users SET avatar=$1 WHERE id=$2', [url, req.user.id]);
  res.json({ avatar: url });
});

// ════════════════════════════════════════════════
// BIENS
// ════════════════════════════════════════════════

app.get('/api/biens', async (req, res) => {
  try {
    const { type, transaction, quartier, has_3d, sort } = req.query;
    let sql = `SELECT b.*, u.nom as agent_nom, u.prenom as agent_prenom, u.agence as agent_agence, u.telephone as agent_tel
               FROM biens b JOIN users u ON b.agent_id = u.id WHERE b.statut = 'actif'`;
    const params = [];
    let i = 1;
    if (type && type !== 'all') { sql += ` AND b.type = $${i++}`; params.push(type); }
    if (transaction && transaction !== 'all') { sql += ` AND b.type_transaction = $${i++}`; params.push(transaction); }
    if (quartier && quartier !== 'all') { sql += ` AND b.quartier = $${i++}`; params.push(quartier); }
    if (has_3d === '1') sql += ' AND b.has_3d = 1';
    if (sort === 'prix_asc') sql += ' ORDER BY b.prix ASC';
    else if (sort === 'prix_desc') sql += ' ORDER BY b.prix DESC';
    else sql += ' ORDER BY b.created_at DESC';
    const biens = await db.all(sql, params);
    res.json(biens.map(parseBien));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/biens/:id', async (req, res) => {
  try {
    const bien = await db.get(
      `SELECT b.*, u.nom as agent_nom, u.prenom as agent_prenom, u.agence as agent_agence, u.telephone as agent_tel
       FROM biens b JOIN users u ON b.agent_id = u.id WHERE b.id = $1`, [req.params.id]
    );
    if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
    await db.run('UPDATE biens SET vues = vues + 1 WHERE id = $1', [req.params.id]);
    await db.run('INSERT INTO visites_historique (id,bien_id,ip) VALUES ($1,$2,$3)', [uuidv4(), req.params.id, req.ip]);
    res.json(parseBien(bien));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/biens', authMiddleware, agentOnly, async (req, res) => {
  try {
    const { titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, equipements } = req.body;
    if (!titre || !type || !transaction || !prix || !quartier) return res.status(400).json({ error: 'Champs obligatoires manquants' });
    const id = uuidv4();
    await db.run(
      `INSERT INTO biens (id,titre,type,type_transaction,prix,surface,chambres,sdb,quartier,commune,adresse,description,equipements,agent_id,statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'brouillon')`,
      [id, titre, type, transaction, prix, surface||null, chambres||0, sdb||1, quartier, commune||'Abidjan', adresse||null, description||null, JSON.stringify(equipements||[]), req.user.id]
    );
    res.json({ id, message: 'Bien créé' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/biens/:id', authMiddleware, agentOnly, async (req, res) => {
  try {
    const { titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, equipements, statut } = req.body;
    await db.run(
      `UPDATE biens SET titre=$1,type=$2,type_transaction=$3,prix=$4,surface=$5,chambres=$6,sdb=$7,quartier=$8,commune=$9,adresse=$10,description=$11,equipements=$12,statut=$13 WHERE id=$14 AND agent_id=$15`,
      [titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, JSON.stringify(equipements||[]), statut||'actif', req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/biens/:id', authMiddleware, agentOnly, async (req, res) => {
  await db.run("UPDATE biens SET statut='supprime' WHERE id=$1 AND agent_id=$2", [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.post('/api/biens/:id/photos', authMiddleware, agentOnly, (req, res, next) => {
  req.uploadSubDir = req.params.id; next();
}, upload.array('photos', 20), async (req, res) => {
  try {
    const bien = await db.get('SELECT photos FROM biens WHERE id=$1 AND agent_id=$2', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Accès refusé' });
    const existing = typeof bien.photos === 'string' ? JSON.parse(bien.photos||'[]') : (bien.photos||[]);
    const newPhotos = req.files.map(f => `/uploads/${req.params.id}/${f.filename}`);
    const all = [...existing, ...newPhotos];
    await db.run("UPDATE biens SET photos=$1, statut='actif' WHERE id=$2", [JSON.stringify(all), req.params.id]);
    res.json({ photos: all });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Scan 3D ───────────────────────────────────────
app.post('/api/biens/:id/scan', authMiddleware, agentOnly, (req, res, next) => {
  req.uploadSubDir = `${req.params.id}/scan360`; next();
}, upload.array('photos360', 50), async (req, res) => {
  try {
    const bien = await db.get('SELECT * FROM biens WHERE id=$1 AND agent_id=$2', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Accès refusé' });
    if (!req.files?.length) return res.status(400).json({ error: 'Aucune photo reçue' });
    const existing = typeof bien.photos_360 === 'string' ? JSON.parse(bien.photos_360||'[]') : (bien.photos_360||[]);
    const newPhotos = req.files.map(f => `/uploads/${req.params.id}/scan360/${f.filename}`);
    const all = [...existing, ...newPhotos];
    await db.run("UPDATE biens SET photos_360=$1, scan_status='processing', has_3d=0 WHERE id=$2", [JSON.stringify(all), req.params.id]);
    setTimeout(async () => {
      await db.run("UPDATE biens SET scan_status='done', has_3d=1 WHERE id=$1", [req.params.id]);
    }, 5000);
    res.json({ message: 'Photos reçues, traitement en cours…', scan_status: 'processing', photos_360: all });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/biens/:id/scan/status', authMiddleware, async (req, res) => {
  const bien = await db.get('SELECT scan_status, has_3d, photos_360 FROM biens WHERE id=$1', [req.params.id]);
  if (!bien) return res.status(404).json({ error: 'Introuvable' });
  res.json({ scan_status: bien.scan_status, has_3d: bien.has_3d, photos_360: typeof bien.photos_360 === 'string' ? JSON.parse(bien.photos_360||'[]') : (bien.photos_360||[]) });
});

app.post('/api/biens/:id/scan/request', authMiddleware, agentOnly, async (req, res) => {
  await db.run("UPDATE biens SET scan_status='requested' WHERE id=$1 AND agent_id=$2", [req.params.id, req.user.id]);
  res.json({ message: 'Demande envoyée. Notre équipe vous contacte sous 24h.' });
});

// ── Agent ─────────────────────────────────────────
app.get('/api/agent/biens', authMiddleware, agentOnly, async (req, res) => {
  const biens = await db.all(
    `SELECT b.*, (SELECT COUNT(*) FROM leads WHERE bien_id=b.id) as nb_leads
     FROM biens b WHERE b.agent_id=$1 AND b.statut != 'supprime' ORDER BY b.created_at DESC`, [req.user.id]
  );
  res.json(biens.map(parseBien));
});

app.get('/api/agent/stats', authMiddleware, agentOnly, async (req, res) => {
  const biens_actifs = (await db.get("SELECT COUNT(*) as n FROM biens WHERE agent_id=$1 AND statut='actif'", [req.user.id]))?.n || 0;
  const total_vues   = (await db.get('SELECT SUM(vues) as n FROM biens WHERE agent_id=$1', [req.user.id]))?.n || 0;
  const total_leads  = (await db.get('SELECT COUNT(*) as n FROM leads WHERE agent_id=$1', [req.user.id]))?.n || 0;
  const biens_3d     = (await db.get('SELECT COUNT(*) as n FROM biens WHERE agent_id=$1 AND has_3d=1', [req.user.id]))?.n || 0;
  const leads_new    = (await db.get("SELECT COUNT(*) as n FROM leads WHERE agent_id=$1 AND statut='nouveau'", [req.user.id]))?.n || 0;
  res.json({ biens_actifs, total_vues, total_leads, biens_3d, leads_new,
    taux_contact: total_vues > 0 ? ((total_leads / total_vues)*100).toFixed(1) : 0 });
});

app.get('/api/agent/leads', authMiddleware, agentOnly, async (req, res) => {
  const leads = await db.all(
    `SELECT l.*, b.titre as bien_titre, b.quartier as bien_quartier
     FROM leads l JOIN biens b ON l.bien_id = b.id WHERE l.agent_id=$1 ORDER BY l.created_at DESC`, [req.user.id]
  );
  res.json(leads);
});

app.put('/api/agent/leads/:id/statut', authMiddleware, agentOnly, async (req, res) => {
  await db.run('UPDATE leads SET statut=$1 WHERE id=$2 AND agent_id=$3', [req.body.statut, req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── Leads ─────────────────────────────────────────
app.post('/api/leads', async (req, res) => {
  try {
    const { bien_id, nom, email, telephone, message, type } = req.body;
    if (!bien_id || !nom) return res.status(400).json({ error: 'Champs manquants' });
    const bien = await db.get('SELECT agent_id FROM biens WHERE id=$1', [bien_id]);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
    await db.run(
      'INSERT INTO leads (id,bien_id,agent_id,visiteur_nom,visiteur_email,visiteur_tel,message,type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uuidv4(), bien_id, bien.agent_id, nom, email||null, telephone||null, message||null, type||'message']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Favoris ───────────────────────────────────────
app.get('/api/favoris', authMiddleware, async (req, res) => {
  const favs = await db.all(
    `SELECT b.*, u.nom as agent_nom, u.agence as agent_agence
     FROM favoris f JOIN biens b ON f.bien_id=b.id JOIN users u ON b.agent_id=u.id
     WHERE f.user_id=$1 AND b.statut='actif' ORDER BY f.created_at DESC`, [req.user.id]
  );
  res.json(favs.map(parseBien));
});

app.post('/api/favoris/:bien_id', authMiddleware, async (req, res) => {
  const exists = await db.get('SELECT id FROM favoris WHERE user_id=$1 AND bien_id=$2', [req.user.id, req.params.bien_id]);
  if (exists) {
    await db.run('DELETE FROM favoris WHERE user_id=$1 AND bien_id=$2', [req.user.id, req.params.bien_id]);
    return res.json({ favori: false });
  }
  await db.run('INSERT INTO favoris (id,user_id,bien_id) VALUES ($1,$2,$3)', [uuidv4(), req.user.id, req.params.bien_id]);
  res.json({ favori: true });
});

// ── Alertes ───────────────────────────────────────
app.get('/api/alertes', authMiddleware, async (req, res) => {
  res.json(await db.all('SELECT * FROM alertes WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]));
});

app.post('/api/alertes', authMiddleware, async (req, res) => {
  const { label, criteres } = req.body;
  const id = uuidv4();
  await db.run('INSERT INTO alertes (id,user_id,label,criteres) VALUES ($1,$2,$3,$4)', [id, req.user.id, label, JSON.stringify(criteres)]);
  res.json({ id, success: true });
});

app.put('/api/alertes/:id/toggle', authMiddleware, async (req, res) => {
  const a = await db.get('SELECT actif FROM alertes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!a) return res.status(404).json({ error: 'Introuvable' });
  await db.run('UPDATE alertes SET actif=$1 WHERE id=$2', [a.actif ? 0 : 1, req.params.id]);
  res.json({ actif: !a.actif });
});

app.delete('/api/alertes/:id', authMiddleware, async (req, res) => {
  await db.run('DELETE FROM alertes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── Historique ────────────────────────────────────
app.get('/api/historique', authMiddleware, async (req, res) => {
  const hist = await db.all(
    `SELECT vh.*, b.titre, b.quartier, b.type, b.prix, b.type_transaction as transaction, b.photos
     FROM visites_historique vh JOIN biens b ON vh.bien_id=b.id
     WHERE vh.user_id=$1 ORDER BY vh.created_at DESC LIMIT 20`, [req.user.id]
  );
  res.json(hist.map(h => ({ ...h, photos: typeof h.photos === 'string' ? JSON.parse(h.photos||'[]') : (h.photos||[]) })));
});

app.post('/api/historique/:bien_id', authMiddleware, async (req, res) => {
  await db.run('INSERT INTO visites_historique (id,user_id,bien_id,ip) VALUES ($1,$2,$3,$4)', [uuidv4(), req.user.id, req.params.bien_id, req.ip]);
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🏠 Immo3D CI démarré sur http://localhost:${PORT}`);
    console.log(`\n📧 Comptes de démo :`);
    console.log(`   Agent    : agent@immo3d.ci / demo1234`);
    console.log(`   Visiteur : visiteur@immo3d.ci / demo1234\n`);
  });
}).catch(e => { console.error('❌ Erreur DB:', e.message); process.exit(1); });
