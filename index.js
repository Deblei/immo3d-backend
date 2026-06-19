const cors = require('cors');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'immo3d-ci-secret-2025';

app.use(cors({
  origin: [
    'https://deblei.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// ── Multer pour uploads ──────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', req.uploadDir || '');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

// ── Base de données ──────────────────────────────
let db;
const DATA_DIR = path.join(__dirname);
const DB_PATH = path.join(DATA_DIR, 'immo3d.db');

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
      created_at TEXT DEFAULT (datetime('now')),
      plan TEXT DEFAULT 'starter'
    );

    CREATE TABLE IF NOT EXISTS biens (
      id TEXT PRIMARY KEY,
      titre TEXT NOT NULL,
      type TEXT NOT NULL,
      type_transaction TEXT NOT NULL,
      prix INTEGER NOT NULL,
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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(agent_id) REFERENCES users(id)
    );

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
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(bien_id) REFERENCES biens(id)
    );

    CREATE TABLE IF NOT EXISTS favoris (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bien_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(bien_id) REFERENCES biens(id)
    );

    CREATE TABLE IF NOT EXISTS alertes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      criteres TEXT NOT NULL,
      actif INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS visites_historique (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      bien_id TEXT NOT NULL,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(bien_id) REFERENCES biens(id)
    );
  `);

  // Seed demo data si la DB est vide
  const count = db.exec('SELECT COUNT(*) as n FROM users')[0]?.values[0][0];
  if (count === 0) await seedDemo();

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function seedDemo() {
  const agentPwd = await bcrypt.hash('demo1234', 10);
  const visiteurPwd = await bcrypt.hash('demo1234', 10);

  const agentId = uuidv4();
  const visiteurId = uuidv4();

  db.run(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),?)`, [
    agentId, 'agent@immo3d.ci', agentPwd, 'Adjoua', 'Kouamé', 'agent',
    '+225 07 00 00 00 00', 'Prestige Immo Abidjan', null, 'premium'
  ]);
  db.run(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),?)`, [
    visiteurId, 'visiteur@immo3d.ci', visiteurPwd, 'Koné', 'Aya', 'visiteur',
    '+225 05 00 00 00 00', null, null, 'free'
  ]);

  const biens = [
    { titre: 'Villa moderne avec piscine', type: 'villa', trans: 'vente', prix: 85000000, surf: 320, ch: 5, sdb: 3, q: 'Cocody', c: 'Abidjan', desc: 'Magnifique villa de standing avec jardin tropical, piscine et vue dégagée. Quartier sécurisé 24/7.', equip: ['Piscine','Garage x2','Groupe électrogène','Climatisation','Cuisine équipée','Terrasse','Sécurité 24/7','Jardin'], has3d: 1 },
    { titre: 'Appartement 4P — Le Plateau', type: 'appartement', trans: 'location', prix: 350000, surf: 95, ch: 3, sdb: 2, q: 'Plateau', c: 'Abidjan', desc: 'Appartement de 95m² au cœur du Plateau, vue mer, immeuble résidentiel sécurisé.', equip: ['Climatisation','Sécurité 24/7','Parking','Internet fibre','Balcon'], has3d: 1 },
    { titre: 'Duplex avec jardin — Bingerville', type: 'duplex', trans: 'vente', prix: 42000000, surf: 180, ch: 4, sdb: 2, q: 'Bingerville', c: 'Abidjan', desc: 'Duplex familial avec beau jardin arboré, quartier résidentiel calme proche de la lagune.', equip: ['Jardin','Groupe électrogène','Parking','Cuisine équipée'], has3d: 1 },
    { titre: 'Studio meublé — Marcory', type: 'studio', trans: 'location', prix: 120000, surf: 38, ch: 1, sdb: 1, q: 'Marcory', c: 'Abidjan', desc: 'Studio entièrement meublé et équipé, idéal pour professionnels. Charges comprises.', equip: ['Meublé','Climatisation','Internet fibre','Sécurité'], has3d: 1 },
    { titre: 'Bureau open space — 2 Plateaux', type: 'bureau', trans: 'location', prix: 480000, surf: 140, ch: 4, sdb: 2, q: '2 Plateaux', c: 'Abidjan', desc: 'Plateau de bureaux moderne, Internet très haut débit, salle de réunion, climatisation centralisée.', equip: ['Internet fibre','Climatisation','Salle de réunion','Parking','Sécurité 24/7'], has3d: 0 },
    { titre: 'Villa contemporaine — Angré', type: 'villa', trans: 'vente', prix: 60000000, surf: 250, ch: 4, sdb: 3, q: 'Angré', c: 'Abidjan', desc: 'Architecture contemporaine épurée, finitions haut de gamme, piscine à débordement. Résidence fermée.', equip: ['Piscine','Garage','Groupe électrogène','Climatisation','Domotique','Sécurité 24/7'], has3d: 1 },
  ];

  for (const b of biens) {
    const bid = uuidv4();
    db.run(`INSERT INTO biens (id,titre,type,type_transaction,prix,surface,chambres,sdb,quartier,commune,description,equipements,statut,has_3d,scan_status,agent_id,vues) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      bid, b.titre, b.type, b.trans, b.prix, b.surf, b.ch, b.sdb, b.q, b.c,
      b.desc, JSON.stringify(b.equip), 'actif', b.has3d ? 1 : 0,
      b.has3d ? 'done' : 'none', agentId, Math.floor(Math.random() * 1000) + 100
    ]);
  }
  console.log('✅ Données de démo créées');
}

// ── Helpers ──────────────────────────────────────
function dbGet(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return null;
  const cols = res[0].columns;
  const vals = res[0].values[0];
  if (!vals) return null;
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}

function dbAll(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

function agentOnly(req, res, next) {
  if (req.user.role !== 'agent') return res.status(403).json({ error: 'Réservé aux agents' });
  next();
}

// ════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nom, prenom, role, telephone, agence } = req.body;
    if (!email || !password || !nom || !prenom) return res.status(400).json({ error: 'Champs manquants' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères)' });
    const exists = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    db.run('INSERT INTO users (id,email,password,nom,prenom,role,telephone,agence) VALUES (?,?,?,?,?,?,?,?)',
      [id, email.toLowerCase(), hash, nom, prenom, role || 'visiteur', telephone || null, agence || null]);
    saveDB();
    const token = jwt.sign({ id, email, role: role || 'visiteur', nom, prenom }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, email, nom, prenom, role: role || 'visiteur', agence } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = dbGet('SELECT * FROM users WHERE email = ?', [email?.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, nom: user.nom, prenom: user.prenom }, JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...userSafe } = user;
    res.json({ token, user: userSafe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = dbGet('SELECT id,email,nom,prenom,role,telephone,agence,avatar,plan,created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { nom, prenom, telephone, agence } = req.body;
    db.run('UPDATE users SET nom=?, prenom=?, telephone=?, agence=? WHERE id=?', [nom, prenom, telephone, agence, req.user.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/password', authMiddleware, async (req, res) => {
  try {
    const { current, nouveau } = req.body;
    const user = dbGet('SELECT password FROM users WHERE id=?', [req.user.id]);
    const ok = await bcrypt.compare(current, user.password);
    if (!ok) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    if (nouveau.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe trop court' });
    const hash = await bcrypt.hash(nouveau, 10);
    db.run('UPDATE users SET password=? WHERE id=?', [hash, req.user.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════
// BIENS ROUTES
// ════════════════════════════════════════════════

app.get('/api/biens', (req, res) => {
  const { type, transaction, quartier, min_prix, max_prix, chambres, has_3d, sort } = req.query;
  let sql = `SELECT b.*, u.nom as agent_nom, u.prenom as agent_prenom, u.agence as agent_agence, u.telephone as agent_tel
             FROM biens b JOIN users u ON b.agent_id = u.id WHERE b.statut = 'actif'`;
  const params = [];
  if (type && type !== 'all') { sql += ' AND b.type = ?'; params.push(type); }
  if (transaction && transaction !== 'all') { sql += ' AND b.type_transaction = ?'; params.push(transaction); }
  if (quartier && quartier !== 'all') { sql += ' AND b.quartier = ?'; params.push(quartier); }
  if (min_prix) { sql += ' AND b.prix >= ?'; params.push(Number(min_prix)); }
  if (max_prix) { sql += ' AND b.prix <= ?'; params.push(Number(max_prix)); }
  if (chambres && chambres !== 'all') {
    if (chambres === '5+') sql += ' AND b.chambres >= 5';
    else { sql += ' AND b.chambres = ?'; params.push(Number(chambres)); }
  }
  if (has_3d === '1') sql += ' AND b.has_3d = 1';
  if (sort === 'prix_asc') sql += ' ORDER BY b.prix ASC';
  else if (sort === 'prix_desc') sql += ' ORDER BY b.prix DESC';
  else if (sort === 'surface') sql += ' ORDER BY b.surface DESC';
  else sql += ' ORDER BY b.created_at DESC';
  const biens = dbAll(sql, params);
  res.json(biens.map(b => ({ ...b, transaction: b.type_transaction, equipements: JSON.parse(b.equipements || '[]'), photos: JSON.parse(b.photos || '[]'), photos_360: JSON.parse(b.photos_360 || '[]') })));
});

app.get('/api/biens/:id', (req, res) => {
  const bien = dbGet(`SELECT b.*, u.nom as agent_nom, u.prenom as agent_prenom, u.agence as agent_agence, u.telephone as agent_tel
                      FROM biens b JOIN users u ON b.agent_id = u.id WHERE b.id = ?`, [req.params.id]);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  // Incrémenter vues
  db.run('UPDATE biens SET vues = vues + 1 WHERE id = ?', [req.params.id]);
  // Enregistrer visite historique
  const hid = uuidv4();
  db.run('INSERT INTO visites_historique (id, user_id, bien_id, ip) VALUES (?,?,?,?)', [hid, null, req.params.id, req.ip]);
  saveDB();
  res.json({ ...bien, transaction: bien.type_transaction, equipements: JSON.parse(bien.equipements || '[]'), photos: JSON.parse(bien.photos || '[]'), photos_360: JSON.parse(bien.photos_360 || '[]') });
});

app.post('/api/biens', authMiddleware, agentOnly, (req, res) => {
  try {
    const { titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, equipements } = req.body;
    if (!titre || !type || !transaction || !prix || !quartier) return res.status(400).json({ error: 'Champs obligatoires manquants' });
    const id = uuidv4();
    db.run(`INSERT INTO biens (id,titre,type,type_transaction,prix,surface,chambres,sdb,quartier,commune,adresse,description,equipements,agent_id,statut)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'brouillon')`,
      [id, titre, type, transaction, prix, surface, chambres, sdb, quartier, commune || 'Abidjan', adresse, description, JSON.stringify(equipements || []), req.user.id]);
    saveDB();
    res.json({ id, message: 'Bien créé avec succès' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/biens/:id', authMiddleware, agentOnly, (req, res) => {
  try {
    const bien = dbGet('SELECT * FROM biens WHERE id=? AND agent_id=?', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Bien introuvable ou accès refusé' });
    const { titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, equipements, statut } = req.body;
    db.run(`UPDATE biens SET titre=?,type=?,type_transaction=?,prix=?,surface=?,chambres=?,sdb=?,quartier=?,commune=?,adresse=?,description=?,equipements=?,statut=? WHERE id=?`,
      [titre, type, transaction, prix, surface, chambres, sdb, quartier, commune, adresse, description, JSON.stringify(equipements || []), statut || bien.statut, req.params.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/biens/:id', authMiddleware, agentOnly, (req, res) => {
  const bien = dbGet('SELECT * FROM biens WHERE id=? AND agent_id=?', [req.params.id, req.user.id]);
  if (!bien) return res.status(403).json({ error: 'Accès refusé' });
  db.run('UPDATE biens SET statut=? WHERE id=?', ['supprime', req.params.id]);
  saveDB();
  res.json({ success: true });
});

// ── Photos d'un bien ──────────────────────────────
app.post('/api/biens/:id/photos', authMiddleware, agentOnly, (req, res, next) => {
  req.uploadDir = req.params.id;
  next();
}, upload.array('photos', 20), (req, res) => {
  try {
    const bien = dbGet('SELECT * FROM biens WHERE id=? AND agent_id=?', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Accès refusé' });
    const existingPhotos = JSON.parse(bien.photos || '[]');
    const newPhotos = req.files.map(f => `/uploads/${req.params.id}/${f.filename}`);
    const allPhotos = [...existingPhotos, ...newPhotos];
    db.run('UPDATE biens SET photos=? WHERE id=?', [JSON.stringify(allPhotos), req.params.id]);
    // Activer le bien si c'est un brouillon avec maintenant des photos
    if (bien.statut === 'brouillon' && allPhotos.length > 0) {
      db.run('UPDATE biens SET statut=? WHERE id=?', ['actif', req.params.id]);
    }
    saveDB();
    res.json({ photos: allPhotos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════
// SCAN 3D — UPLOAD PHOTOS 360°
// ════════════════════════════════════════════════

app.post('/api/biens/:id/scan', authMiddleware, agentOnly, (req, res, next) => {
  req.uploadDir = `${req.params.id}/scan360`;
  next();
}, upload.array('photos360', 50), async (req, res) => {
  try {
    const bien = dbGet('SELECT * FROM biens WHERE id=? AND agent_id=?', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Accès refusé' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Aucune photo reçue' });

    const newPhotos360 = req.files.map(f => `/uploads/${req.params.id}/scan360/${f.filename}`);
    const existing360 = JSON.parse(bien.photos_360 || '[]');
    const all360 = [...existing360, ...newPhotos360];

    // Passer en statut "processing"
    db.run('UPDATE biens SET photos_360=?, scan_status=?, has_3d=0 WHERE id=?',
      [JSON.stringify(all360), 'processing', req.params.id]);
    saveDB();

    // Simuler traitement 3D (5 secondes)
    setTimeout(() => {
      db.run('UPDATE biens SET scan_status=?, has_3d=1 WHERE id=?', ['done', req.params.id]);
      saveDB();
      console.log(`✅ Scan 3D terminé pour le bien ${req.params.id}`);
    }, 5000);

    res.json({
      message: 'Photos 360° reçues. Traitement 3D en cours...',
      photos_360: all360,
      scan_status: 'processing',
      estimated_time: '5 secondes (démo)'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/biens/:id/scan/status', authMiddleware, (req, res) => {
  const bien = dbGet('SELECT scan_status, has_3d, photos_360 FROM biens WHERE id=?', [req.params.id]);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  res.json({ scan_status: bien.scan_status, has_3d: bien.has_3d, photos_360: JSON.parse(bien.photos_360 || '[]') });
});

app.post('/api/biens/:id/scan/request', authMiddleware, agentOnly, (req, res) => {
  try {
    const { disponibilite, telephone, adresse_precise } = req.body;
    const bien = dbGet('SELECT * FROM biens WHERE id=? AND agent_id=?', [req.params.id, req.user.id]);
    if (!bien) return res.status(403).json({ error: 'Accès refusé' });
    db.run('UPDATE biens SET scan_status=? WHERE id=?', ['requested', req.params.id]);
    saveDB();
    res.json({ message: 'Demande de scan envoyée. Notre équipe vous contactera sous 24h.', disponibilite, telephone, adresse_precise });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════
// AGENT — MES BIENS & STATS
// ════════════════════════════════════════════════

app.get('/api/agent/biens', authMiddleware, agentOnly, (req, res) => {
  const biens = dbAll(`SELECT b.*, 
    (SELECT COUNT(*) FROM leads WHERE bien_id=b.id) as nb_leads
    FROM biens b WHERE b.agent_id=? AND b.statut != 'supprime' ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(biens.map(b => ({ ...b, transaction: b.type_transaction, equipements: JSON.parse(b.equipements || '[]'), photos: JSON.parse(b.photos || '[]'), photos_360: JSON.parse(b.photos_360 || '[]') })));
});

app.get('/api/agent/stats', authMiddleware, agentOnly, (req, res) => {
  const biens_actifs = dbGet('SELECT COUNT(*) as n FROM biens WHERE agent_id=? AND statut="actif"', [req.user.id])?.n || 0;
  const total_vues = dbGet('SELECT SUM(vues) as n FROM biens WHERE agent_id=?', [req.user.id])?.n || 0;
  const total_leads = dbGet('SELECT COUNT(*) as n FROM leads WHERE agent_id=?', [req.user.id])?.n || 0;
  const biens_3d = dbGet('SELECT COUNT(*) as n FROM biens WHERE agent_id=? AND has_3d=1', [req.user.id])?.n || 0;
  const leads_new = dbGet('SELECT COUNT(*) as n FROM leads WHERE agent_id=? AND statut="nouveau"', [req.user.id])?.n || 0;
  res.json({ biens_actifs, total_vues, total_leads, biens_3d, leads_new, taux_contact: total_vues > 0 ? ((total_leads / total_vues) * 100).toFixed(1) : 0 });
});

app.get('/api/agent/leads', authMiddleware, agentOnly, (req, res) => {
  const leads = dbAll(`SELECT l.*, b.titre as bien_titre, b.quartier as bien_quartier
    FROM leads l JOIN biens b ON l.bien_id = b.id
    WHERE l.agent_id=? ORDER BY l.created_at DESC`, [req.user.id]);
  res.json(leads);
});

app.put('/api/agent/leads/:id/statut', authMiddleware, agentOnly, (req, res) => {
  db.run('UPDATE leads SET statut=? WHERE id=? AND agent_id=?', [req.body.statut, req.params.id, req.user.id]);
  saveDB();
  res.json({ success: true });
});

// ════════════════════════════════════════════════
// VISITEUR — LEADS / CONTACTS
// ════════════════════════════════════════════════

app.post('/api/leads', (req, res) => {
  try {
    const { bien_id, nom, email, telephone, message, type } = req.body;
    if (!bien_id || !nom) return res.status(400).json({ error: 'Champs manquants' });
    const bien = dbGet('SELECT agent_id FROM biens WHERE id=?', [bien_id]);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
    const id = uuidv4();
    db.run('INSERT INTO leads (id,bien_id,agent_id,visiteur_nom,visiteur_email,visiteur_tel,message,type) VALUES (?,?,?,?,?,?,?,?)',
      [id, bien_id, bien.agent_id, nom, email, telephone, message, type || 'message']);
    saveDB();
    res.json({ success: true, message: 'Votre message a été envoyé à l\'agent.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════
// FAVORIS
// ════════════════════════════════════════════════

app.get('/api/favoris', authMiddleware, (req, res) => {
  const favs = dbAll(`SELECT b.*, u.nom as agent_nom, u.agence as agent_agence
    FROM favoris f JOIN biens b ON f.bien_id=b.id JOIN users u ON b.agent_id=u.id
    WHERE f.user_id=? AND b.statut='actif' ORDER BY f.created_at DESC`, [req.user.id]);
  res.json(favs.map(b => ({ ...b, transaction: b.type_transaction, equipements: JSON.parse(b.equipements || '[]'), photos: JSON.parse(b.photos || '[]') })));
});

app.post('/api/favoris/:bien_id', authMiddleware, (req, res) => {
  const exists = dbGet('SELECT id FROM favoris WHERE user_id=? AND bien_id=?', [req.user.id, req.params.bien_id]);
  if (exists) {
    db.run('DELETE FROM favoris WHERE user_id=? AND bien_id=?', [req.user.id, req.params.bien_id]);
    saveDB();
    return res.json({ favori: false });
  }
  const id = uuidv4();
  db.run('INSERT INTO favoris (id,user_id,bien_id) VALUES (?,?,?)', [id, req.user.id, req.params.bien_id]);
  saveDB();
  res.json({ favori: true });
});

// ════════════════════════════════════════════════
// ALERTES
// ════════════════════════════════════════════════

app.get('/api/alertes', authMiddleware, (req, res) => {
  res.json(dbAll('SELECT * FROM alertes WHERE user_id=? ORDER BY created_at DESC', [req.user.id]));
});

app.post('/api/alertes', authMiddleware, (req, res) => {
  const { label, criteres } = req.body;
  const id = uuidv4();
  db.run('INSERT INTO alertes (id,user_id,label,criteres) VALUES (?,?,?,?)', [id, req.user.id, label, JSON.stringify(criteres)]);
  saveDB();
  res.json({ id, success: true });
});

app.put('/api/alertes/:id/toggle', authMiddleware, (req, res) => {
  const alerte = dbGet('SELECT actif FROM alertes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!alerte) return res.status(404).json({ error: 'Alerte introuvable' });
  db.run('UPDATE alertes SET actif=? WHERE id=?', [alerte.actif ? 0 : 1, req.params.id]);
  saveDB();
  res.json({ actif: !alerte.actif });
});

app.delete('/api/alertes/:id', authMiddleware, (req, res) => {
  db.run('DELETE FROM alertes WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  saveDB();
  res.json({ success: true });
});

// ════════════════════════════════════════════════
// HISTORIQUE VISITES
// ════════════════════════════════════════════════

app.get('/api/historique', authMiddleware, (req, res) => {
  // Enregistrer la visite associée à l'utilisateur si possible
  const hist = dbAll(`SELECT vh.*, b.titre, b.quartier, b.type, b.prix, b.type_transaction, b.photos
    FROM visites_historique vh JOIN biens b ON vh.bien_id=b.id
    WHERE vh.user_id=? ORDER BY vh.created_at DESC LIMIT 20`, [req.user.id]);
  res.json(hist.map(h => ({ ...h, photos: JSON.parse(h.photos || '[]') })));
});

app.post('/api/historique/:bien_id', authMiddleware, (req, res) => {
  const id = uuidv4();
  db.run('INSERT INTO visites_historique (id,user_id,bien_id,ip) VALUES (?,?,?,?)', [id, req.user.id, req.params.bien_id, req.ip]);
  saveDB();
  res.json({ success: true });
});

// ════════════════════════════════════════════════
// AVATAR UPLOAD
// ════════════════════════════════════════════════

app.post('/api/auth/avatar', authMiddleware, (req, res, next) => {
  req.uploadDir = 'avatars';
  next();
}, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const url = `/uploads/avatars/${req.file.filename}`;
  db.run('UPDATE users SET avatar=? WHERE id=?', [url, req.user.id]);
  saveDB();
  res.json({ avatar: url });
});

// ── SPA fallback ─────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Démarrage ────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🏠 Immo3D CI démarré sur http://localhost:${PORT}`);
    console.log(`\n📧 Comptes de démo :`);
    console.log(`   Agent    : agent@immo3d.ci / demo1234`);
    console.log(`   Visiteur : visiteur@immo3d.ci / demo1234\n`);
  });
}).catch(console.error);
