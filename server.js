const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'bankroll.sqlite'));
db.pragma('journal_mode = WAL');

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sportsbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      starting_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(snapshot_date)
    );
    CREATE TABLE IF NOT EXISTS snapshot_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      sportsbook_id INTEGER NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(snapshot_id) REFERENCES daily_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY(sportsbook_id) REFERENCES sportsbooks(id) ON DELETE CASCADE,
      UNIQUE(snapshot_id, sportsbook_id)
    );
  `);
  const get = db.prepare('SELECT value FROM settings WHERE key=?');
  const set = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  if (!get.get('handlerName')) set.run('handlerName', 'Bankroll Handler');
  if (!get.get('closeTime')) set.run('closeTime', '21:00');
  if (!get.get('timezone')) set.run('timezone', 'America/Phoenix');
  if (!get.get('setupComplete')) set.run('setupComplete', 'false');
  if (!get.get('startingBankroll')) set.run('startingBankroll', '0');
  if (!get.get('cashReserve')) set.run('cashReserve', '0');
  if (!get.get('initialAllocationDate')) set.run('initialAllocationDate', new Date().toISOString().slice(0,10));
  // Keep Railway ADMIN_PASSWORD authoritative. This avoids lockouts when the
  // password is changed after the SQLite database already exists.
  if (process.env.ADMIN_PASSWORD) {
    set.run('passwordHash', bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10));
    set.run('passwordMode', 'railway-env');
  } else if (!get.get('passwordHash')) {
    set.run('passwordHash', bcrypt.hashSync(ADMIN_PASSWORD, 10));
    set.run('passwordMode', 'default-admin');
  }
}
init();

function setting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, String(value));
}
function auth(req, res, next) {
  const token = req.cookies.bt_session || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, SESSION_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }
}
function books() {
  return db.prepare('SELECT * FROM sportsbooks WHERE active=1 ORDER BY id').all();
}
function latestSnapshot() {
  const snap = db.prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT 1').get();
  if (!snap) return null;
  snap.balances = db.prepare(`SELECT sb.*, s.name FROM snapshot_balances sb JOIN sportsbooks s ON s.id=sb.sportsbook_id WHERE snapshot_id=? ORDER BY s.id`).all(snap.id);
  return snap;
}
function allSnapshots() {
  const snaps = db.prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date ASC').all();
  const stmt = db.prepare(`SELECT sb.*, s.name FROM snapshot_balances sb JOIN sportsbooks s ON s.id=sb.sportsbook_id WHERE snapshot_id=? ORDER BY s.id`);
  return snaps.map(s => ({...s, balances: stmt.all(s.id)}));
}
function analytics() {
  const bks = books();
  const configuredStart = Number(setting('startingBankroll') || 0);
  const cashReserve = Number(setting('cashReserve') || 0);
  const bookStartTotal = bks.reduce((a,b)=>a+Number(b.starting_balance||0),0);
  const startTotal = configuredStart || (bookStartTotal + cashReserve);
  const currentTotal = bks.reduce((a,b)=>a+Number(b.current_balance||0),0) + cashReserve;
  const snaps = allSnapshots();
  const series = snaps.map(s => ({ date: s.snapshot_date, total: s.balances.reduce((a,b)=>a+Number(b.balance||0),0) + cashReserve }));
  const daily = series.map((p,i)=>({ date:p.date, total:p.total, pnl: i===0 ? p.total - startTotal : p.total - series[i-1].total }));
  const weekPnL = daily.slice(-7).reduce((a,d)=>a+d.pnl,0);
  const monthPnL = daily.slice(-30).reduce((a,d)=>a+d.pnl,0);
  let peak = startTotal || 0, maxDrawdown = 0, seasonHigh = startTotal || 0, seasonLow = startTotal || currentTotal || 0, peakROI = 0;
  const drawdownSeries = [];
  for (const p of series) {
    peak = Math.max(peak, p.total);
    seasonHigh = Math.max(seasonHigh, p.total);
    seasonLow = Math.min(seasonLow, p.total);
    const dd = p.total - peak;
    maxDrawdown = Math.min(maxDrawdown, dd);
    const roi = startTotal ? ((p.total - startTotal) / startTotal) * 100 : 0;
    peakROI = Math.max(peakROI, roi);
    drawdownSeries.push({ date: p.date, drawdown: dd, drawdownPct: peak ? (dd / peak) * 100 : 0 });
  }
  seasonHigh = Math.max(seasonHigh, currentTotal);
  seasonLow = Math.min(seasonLow, currentTotal);
  const currentDrawdown = currentTotal - seasonHigh;
  const currentDrawdownPct = seasonHigh ? (currentDrawdown / seasonHigh) * 100 : 0;
  const best = daily.length ? daily.reduce((a,b)=>b.pnl>a.pnl?b:a,daily[0]) : null;
  const worst = daily.length ? daily.reduce((a,b)=>b.pnl<a.pnl?b:a,daily[0]) : null;
  const latestPnL = daily.length ? daily[daily.length-1].pnl : currentTotal - startTotal;
  const monthly = {};
  daily.forEach(d => { const key = String(d.date).slice(0,7); if (!monthly[key]) monthly[key] = { month:key, pnl:0, ending:d.total }; monthly[key].pnl += d.pnl; monthly[key].ending = d.total; });
  const monthlySeries = Object.values(monthly).map(m => ({...m, roi: startTotal ? (m.pnl / startTotal) * 100 : 0}));
  const booksRanked = bks.map(b => ({
    id:b.id,
    name:b.name,
    starting:Number(b.starting_balance),
    current:Number(b.current_balance),
    pnl:Number(b.current_balance)-Number(b.starting_balance),
    roi:Number(b.starting_balance) ? ((Number(b.current_balance)-Number(b.starting_balance))/Number(b.starting_balance))*100 : 0,
    share: currentTotal ? Number(b.current_balance)/currentTotal*100 : 0
  })).sort((a,b)=>b.pnl-a.pnl);
  return { startTotal, cashReserve, bookStartTotal, currentTotal, netPnL: currentTotal-startTotal, roi: startTotal ? (currentTotal-startTotal)/startTotal*100 : 0, todayPnL: latestPnL, weekPnL, monthPnL, maxDrawdown, currentDrawdown, currentDrawdownPct, seasonHigh, seasonLow, peakROI, best, worst, series, daily, drawdownSeries, monthlySeries, booksRanked, snapshotCount: snaps.length };
}

function verification() {
  const dbPath = path.join(DATA_DIR, 'bankroll.sqlite');
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  const latest = db.prepare('SELECT snapshot_date, created_at FROM daily_snapshots ORDER BY created_at DESC, id DESC LIMIT 1').get();
  const count = db.prepare('SELECT COUNT(*) c FROM daily_snapshots').get().c;
  const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  return {
    storage: DATA_DIR,
    database: path.basename(dbPath),
    databaseExists: fs.existsSync(dbPath),
    databaseSizeBytes: size,
    walExists: fs.existsSync(walPath),
    shmExists: fs.existsSync(shmPath),
    latestSnapshotDate: latest ? latest.snapshot_date : null,
    lastSavedAt: latest ? latest.created_at : null,
    snapshotCount: count
  };
}

function snapshotHistory(limit = 100) {
  const snaps = db.prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC, id DESC LIMIT ?').all(limit);
  const stmt = db.prepare(`SELECT sb.*, s.name FROM snapshot_balances sb JOIN sportsbooks s ON s.id=sb.sportsbook_id WHERE snapshot_id=? ORDER BY s.id`);
  return snaps.map(s => {
    const balances = stmt.all(s.id);
    return {
      id: s.id,
      snapshot_date: s.snapshot_date,
      created_at: s.created_at,
      notes: s.notes || '',
      total: balances.reduce((sum, b) => sum + Number(b.balance || 0), 0) + Number(setting('cashReserve') || 0),
      balances
    };
  });
}

app.post('/api/login', (req,res)=>{
  const { password } = req.body || {};
  if (!bcrypt.compareSync(String(password || '').trim(), setting('passwordHash'))) return res.status(401).json({ error: 'Invalid password. Check Railway ADMIN_PASSWORD, then redeploy.' });
  const token = jwt.sign({ role: 'admin' }, SESSION_SECRET, { expiresIn: '12h' });
  res.cookie('bt_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12*60*60*1000 });
  res.json({ ok:true });
});
app.post('/api/logout', (req,res)=>{ res.clearCookie('bt_session'); res.json({ ok:true }); });
app.get('/api/me', auth, (req,res)=> res.json({ ok:true }));
app.get('/api/auth-status', (req,res)=> res.json({ ok:true, hasRailwayPassword: Boolean(process.env.ADMIN_PASSWORD), passwordMode: setting('passwordMode') || 'unknown' }));

app.get('/api/state', auth, (req,res)=>{
  res.json({
    settings: { handlerName: setting('handlerName'), closeTime: setting('closeTime'), timezone: setting('timezone'), setupComplete: setting('setupComplete') === 'true', startingBankroll: Number(setting('startingBankroll') || 0), cashReserve: Number(setting('cashReserve') || 0), initialAllocationDate: setting('initialAllocationDate') },
    sportsbooks: books(),
    latestSnapshot: latestSnapshot(),
    analytics: analytics(),
    verification: verification(),
    snapshots: snapshotHistory(100)
  });
});
app.post('/api/setup', auth, (req,res)=>{
  const { handlerName, closeTime, timezone, startingBankroll, cashReserve=0, initialAllocationDate, sportsbooks } = req.body || {};
  if (handlerName) setSetting('handlerName', handlerName);
  if (closeTime) setSetting('closeTime', closeTime);
  if (timezone) setSetting('timezone', timezone);
  if (!Array.isArray(sportsbooks) || sportsbooks.length < 1 || sportsbooks.length > 10) return res.status(400).json({ error:'Add 1 to 10 sportsbooks.' });
  const start = Number(startingBankroll || 0);
  const reserve = Number(cashReserve || 0);
  const booksTotal = sportsbooks.reduce((sum,b)=>sum+Number(b.starting_balance || 0),0);
  if (start <= 0) return res.status(400).json({ error:'Enter a starting bankroll greater than 0.' });
  if (reserve < 0) return res.status(400).json({ error:'Cash reserve cannot be negative.' });
  if (Math.abs((booksTotal + reserve) - start) > 0.01) return res.status(400).json({ error:`Initial allocation must equal starting bankroll. Books plus cash reserve is $${(booksTotal+reserve).toFixed(2)}, starting bankroll is $${start.toFixed(2)}.` });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM snapshot_balances').run();
    db.prepare('DELETE FROM daily_snapshots').run();
    db.prepare('DELETE FROM sportsbooks').run();
    const stmt = db.prepare('INSERT INTO sportsbooks(name, starting_balance, current_balance) VALUES(?,?,?)');
    sportsbooks.slice(0,10).forEach(b => stmt.run(String(b.name||'Book').trim(), Number(b.starting_balance || 0), Number(b.starting_balance || 0)));
    setSetting('startingBankroll', start.toFixed(2));
    setSetting('cashReserve', reserve.toFixed(2));
    setSetting('initialAllocationDate', initialAllocationDate || new Date().toISOString().slice(0,10));
    db.prepare('INSERT OR REPLACE INTO daily_snapshots(snapshot_date, notes) VALUES(?,?)').run(initialAllocationDate || new Date().toISOString().slice(0,10), 'Day 0 initial allocation');
    const snap = db.prepare('SELECT id FROM daily_snapshots WHERE snapshot_date=?').get(initialAllocationDate || new Date().toISOString().slice(0,10));
    const allBooks = db.prepare('SELECT id, starting_balance FROM sportsbooks WHERE active=1 ORDER BY id').all();
    const ins = db.prepare('INSERT OR REPLACE INTO snapshot_balances(snapshot_id, sportsbook_id, balance) VALUES(?,?,?)');
    allBooks.forEach(b => ins.run(snap.id, b.id, Number(b.starting_balance || 0)));
    setSetting('setupComplete', 'true');
  });
  tx();
  res.json({ ok:true });
});
app.post('/api/settings', auth, (req,res)=>{
  const { handlerName, closeTime, timezone, newPassword } = req.body || {};
  if (handlerName !== undefined) setSetting('handlerName', handlerName);
  if (closeTime !== undefined) setSetting('closeTime', closeTime);
  if (timezone !== undefined) setSetting('timezone', timezone);
  if (newPassword) setSetting('passwordHash', bcrypt.hashSync(newPassword, 10));
  res.json({ ok:true });
});
app.post('/api/sportsbooks', auth, (req,res)=>{
  const count = db.prepare('SELECT COUNT(*) c FROM sportsbooks WHERE active=1').get().c;
  if (count >= 10) return res.status(400).json({ error:'Maximum 10 sportsbooks.' });
  const { name, starting_balance=0, current_balance=starting_balance } = req.body || {};
  db.prepare('INSERT INTO sportsbooks(name, starting_balance, current_balance) VALUES(?,?,?)').run(String(name||'Book').trim(), Number(starting_balance), Number(current_balance));
  res.json({ ok:true });
});
app.put('/api/sportsbooks/:id', auth, (req,res)=>{
  const { name, starting_balance, current_balance, active } = req.body || {};
  const existing = db.prepare('SELECT * FROM sportsbooks WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error:'Not found' });
  db.prepare('UPDATE sportsbooks SET name=?, starting_balance=?, current_balance=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name ?? existing.name, Number(starting_balance ?? existing.starting_balance), Number(current_balance ?? existing.current_balance), active === undefined ? existing.active : Number(active), req.params.id);
  res.json({ ok:true });
});
app.delete('/api/sportsbooks/:id', auth, (req,res)=>{ db.prepare('UPDATE sportsbooks SET active=0 WHERE id=?').run(req.params.id); res.json({ ok:true }); });
app.post('/api/daily-close', auth, (req,res)=>{
  const { snapshot_date, balances, notes='' } = req.body || {};
  if (!snapshot_date || !Array.isArray(balances)) return res.status(400).json({ error:'Missing date or balances.' });
  const tx = db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO daily_snapshots(snapshot_date, notes) VALUES(?,?)').run(snapshot_date, notes);
    const snap = db.prepare('SELECT id FROM daily_snapshots WHERE snapshot_date=?').get(snapshot_date);
    db.prepare('DELETE FROM snapshot_balances WHERE snapshot_id=?').run(snap.id);
    const ins = db.prepare('INSERT INTO snapshot_balances(snapshot_id, sportsbook_id, balance) VALUES(?,?,?)');
    const upd = db.prepare('UPDATE sportsbooks SET current_balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    balances.forEach(b => { ins.run(snap.id, Number(b.sportsbook_id), Number(b.balance)); upd.run(Number(b.balance), Number(b.sportsbook_id)); });
  });
  tx();
  res.json({
    ok:true,
    settings: { handlerName: setting('handlerName'), closeTime: setting('closeTime'), timezone: setting('timezone'), setupComplete: setting('setupComplete') === 'true', startingBankroll: Number(setting('startingBankroll') || 0), cashReserve: Number(setting('cashReserve') || 0), initialAllocationDate: setting('initialAllocationDate') },
    sportsbooks: books(),
    latestSnapshot: latestSnapshot(),
    analytics: analytics(),
    verification: verification(),
    snapshots: snapshotHistory(100)
  });
});

app.post('/api/reset/snapshots', auth, (req,res)=>{
  const { confirm } = req.body || {};
  if (confirm !== 'RESET') return res.status(400).json({ error:'Type RESET to confirm snapshot reset.' });
  const tx = db.transaction(() => {
    const day0 = setting('initialAllocationDate') || new Date().toISOString().slice(0,10);
    const activeBooks = books();
    db.prepare('DELETE FROM snapshot_balances').run();
    db.prepare('DELETE FROM daily_snapshots').run();
    db.prepare('INSERT OR REPLACE INTO daily_snapshots(snapshot_date, notes) VALUES(?,?)').run(day0, 'Day 0 baseline restored after reset');
    const snap = db.prepare('SELECT id FROM daily_snapshots WHERE snapshot_date=?').get(day0);
    const ins = db.prepare('INSERT INTO snapshot_balances(snapshot_id, sportsbook_id, balance) VALUES(?,?,?)');
    const upd = db.prepare('UPDATE sportsbooks SET current_balance=starting_balance, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    activeBooks.forEach(b => { ins.run(snap.id, b.id, Number(b.starting_balance||0)); upd.run(b.id); });
  });
  tx();
  res.json({ ok:true, message:'Snapshot history reset to Day 0 baseline.' });
});

app.post('/api/reset/all', auth, (req,res)=>{
  const { confirm } = req.body || {};
  if (confirm !== 'DELETE') return res.status(400).json({ error:'Type DELETE to confirm full data reset.' });
  const keepHash = setting('passwordHash');
  const keepMode = setting('passwordMode');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM snapshot_balances').run();
    db.prepare('DELETE FROM daily_snapshots').run();
    db.prepare('DELETE FROM sportsbooks').run();
    db.prepare('DELETE FROM settings').run();
    setSetting('handlerName', 'Bankroll Handler');
    setSetting('closeTime', '21:00');
    setSetting('timezone', 'America/Phoenix');
    setSetting('setupComplete', 'false');
    setSetting('startingBankroll', '0');
    setSetting('cashReserve', '0');
    setSetting('initialAllocationDate', new Date().toISOString().slice(0,10));
    if (keepHash) setSetting('passwordHash', keepHash);
    if (keepMode) setSetting('passwordMode', keepMode);
  });
  tx();
  res.json({ ok:true, message:'All bankroll data reset. Security password preserved.' });
});


function backupPayload() {
  return {
    app: 'Bankroll Accounting Pro',
    version: '1.1.0',
    exported_at: new Date().toISOString(),
    settings: db.prepare('SELECT key, value FROM settings ORDER BY key').all(),
    sportsbooks: db.prepare('SELECT * FROM sportsbooks ORDER BY id').all(),
    daily_snapshots: db.prepare('SELECT * FROM daily_snapshots ORDER BY id').all(),
    snapshot_balances: db.prepare('SELECT * FROM snapshot_balances ORDER BY id').all()
  };
}

app.get('/api/backup/json', auth, (req,res)=>{
  const body = JSON.stringify(backupPayload(), null, 2);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=bankroll-backup-${new Date().toISOString().slice(0,10)}.json`);
  res.send(body);
});

app.post('/api/restore/json', auth, (req,res)=>{
  const payload = req.body || {};
  if (!Array.isArray(payload.settings) || !Array.isArray(payload.sportsbooks) || !Array.isArray(payload.daily_snapshots) || !Array.isArray(payload.snapshot_balances)) {
    return res.status(400).json({ error:'Invalid backup file.' });
  }
  const currentHash = setting('passwordHash');
  const currentMode = setting('passwordMode');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM snapshot_balances').run();
    db.prepare('DELETE FROM daily_snapshots').run();
    db.prepare('DELETE FROM sportsbooks').run();
    db.prepare('DELETE FROM settings').run();
    const setStmt = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
    payload.settings.forEach(r => {
      if (r.key !== 'passwordHash' && r.key !== 'passwordMode') setStmt.run(String(r.key), String(r.value));
    });
    if (currentHash) setStmt.run('passwordHash', currentHash);
    if (currentMode) setStmt.run('passwordMode', currentMode);
    const bookStmt = db.prepare('INSERT INTO sportsbooks(id,name,starting_balance,current_balance,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    payload.sportsbooks.forEach(r => bookStmt.run(r.id, r.name, Number(r.starting_balance||0), Number(r.current_balance||0), Number(r.active ?? 1), r.created_at || new Date().toISOString(), r.updated_at || new Date().toISOString()));
    const snapStmt = db.prepare('INSERT INTO daily_snapshots(id,snapshot_date,notes,created_at) VALUES(?,?,?,?)');
    payload.daily_snapshots.forEach(r => snapStmt.run(r.id, r.snapshot_date, r.notes || '', r.created_at || new Date().toISOString()));
    const balStmt = db.prepare('INSERT INTO snapshot_balances(id,snapshot_id,sportsbook_id,balance) VALUES(?,?,?,?)');
    payload.snapshot_balances.forEach(r => balStmt.run(r.id, r.snapshot_id, r.sportsbook_id, Number(r.balance||0)));
  });
  tx();
  res.json({ ok:true, message:'Backup restored.' });
});

app.get('/api/export/:type', auth, (req,res)=>{
  const a = analytics(); const bks = books(); const snaps = allSnapshots(); const type = req.params.type;
  if (type === 'csv') {
    const rows = [['Date','Total Bankroll','Change','ROI %','Notes']];
    let prevTotal = a.startTotal;
    snaps.forEach(s => {
      const total = s.balances.reduce((x,y)=>x+Number(y.balance),0) + a.cashReserve;
      const change = total - prevTotal;
      rows.push([s.snapshot_date,total.toFixed(2),change.toFixed(2),(a.startTotal ? ((total-a.startTotal)/a.startTotal*100) : 0).toFixed(2),String(s.notes||'').replace(/"/g,'""')]);
      prevTotal = total;
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename=bankroll-history.csv');
    return res.send(csv);
  }
  const lines = [];
  lines.push(`# Bankroll Report - ${setting('handlerName')}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(`Starting bankroll: $${a.startTotal.toFixed(2)}`);
  lines.push(`Cash reserve: $${a.cashReserve.toFixed(2)}`);
  lines.push(`Current bankroll: $${a.currentTotal.toFixed(2)}`);
  lines.push(`Net P/L: $${a.netPnL.toFixed(2)} (${a.roi.toFixed(2)}%)`);
  lines.push(`Season high: $${a.seasonHigh.toFixed(2)}`);
  lines.push(`Season low: $${a.seasonLow.toFixed(2)}`);
  lines.push(`Current drawdown: $${a.currentDrawdown.toFixed(2)} (${a.currentDrawdownPct.toFixed(2)}%)`);
  lines.push(''); lines.push('## Sportsbook Performance Rankings');
  a.booksRanked.forEach((b,i)=> lines.push(`${i+1}. ${b.name}: current $${b.current.toFixed(2)}, start $${b.starting.toFixed(2)}, P/L $${b.pnl.toFixed(2)}, ROI ${b.roi.toFixed(2)}%, share ${b.share.toFixed(2)}%`));
  lines.push(''); lines.push('## Update Bankroll History');
  snaps.forEach(s=> lines.push(`- ${s.snapshot_date}: $${(s.balances.reduce((x,y)=>x+Number(y.balance),0)+a.cashReserve).toFixed(2)} ${s.notes ? '- '+s.notes : ''}`));
  const body = type === 'txt' ? lines.map(l=>l.replace(/^#+\s*/,'')).join('\n') : lines.join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename=bankroll-report.${type === 'txt' ? 'txt' : 'md'}`);
  res.send(body);
});

app.get('*', (req,res)=>res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, ()=> console.log(`Bankroll Accounting Pro running on ${PORT}`));
