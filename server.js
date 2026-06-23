require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const dbPath = path.join(__dirname, 'data', 'bankroll.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handler TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  starting_bankroll REAL NOT NULL DEFAULT 0,
  disclaimer_accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  opening_amount REAL NOT NULL DEFAULT 0,
  current_amount REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  close_date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, book_id, close_date),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(book_id) REFERENCES books(id)
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER,
  bet_date TEXT NOT NULL,
  sport TEXT DEFAULT '',
  market TEXT DEFAULT '',
  stake REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  odds TEXT DEFAULT '',
  result TEXT DEFAULT 'settled',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(book_id) REFERENCES books(id)
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 180 }));
app.use(express.static(path.join(__dirname, 'public')));

function now() { return new Date().toISOString(); }
function sign(user) { return jwt.sign({ id: user.id, handler: user.handler }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
}
function money(n) { return Number(Number(n || 0).toFixed(2)); }
function userPayload(user) { return { id: user.id, handler: user.handler, startingBankroll: user.starting_bankroll, disclaimerAccepted: !!user.disclaimer_accepted }; }

app.post('/api/register', (req, res) => {
  const { handler, password, startingBankroll, disclaimerAccepted } = req.body;
  if (!handler || !password || password.length < 6) return res.status(400).json({ error: 'Handler and password of 6+ characters required.' });
  if (!disclaimerAccepted) return res.status(400).json({ error: 'Disclaimer must be accepted.' });
  try {
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare('INSERT INTO users(handler,password_hash,starting_bankroll,disclaimer_accepted,created_at) VALUES(?,?,?,?,?)')
      .run(handler.trim(), hash, money(startingBankroll), 1, now());
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    res.json({ token: sign(user), user: userPayload(user) });
  } catch (e) { res.status(409).json({ error: 'That handler is already taken.' }); }
});

app.post('/api/login', (req, res) => {
  const { handler, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE handler=?').get((handler || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Invalid login.' });
  res.json({ token: sign(user), user: userPayload(user) });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: userPayload(user) });
});

app.put('/api/me', auth, (req, res) => {
  db.prepare('UPDATE users SET starting_bankroll=? WHERE id=?').run(money(req.body.startingBankroll), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: userPayload(user) });
});

app.get('/api/books', auth, (req, res) => {
  const books = db.prepare('SELECT * FROM books WHERE user_id=? AND active=1 ORDER BY name').all(req.user.id);
  res.json({ books: books.map(b => ({ id: b.id, name: b.name, openingAmount: b.opening_amount, currentAmount: b.current_amount })) });
});

app.post('/api/books', auth, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) c FROM books WHERE user_id=? AND active=1').get(req.user.id).c;
  if (count >= 10) return res.status(400).json({ error: 'Maximum of 10 active sportsbooks reached.' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Book name required.' });
  const amount = money(req.body.openingAmount);
  try {
    const info = db.prepare('INSERT INTO books(user_id,name,opening_amount,current_amount,active,created_at) VALUES(?,?,?,?,1,?)').run(req.user.id, name, amount, amount, now());
    res.json({ id: info.lastInsertRowid, name, openingAmount: amount, currentAmount: amount });
  } catch { res.status(409).json({ error: 'Book name already exists.' }); }
});

app.put('/api/books/:id', auth, (req, res) => {
  db.prepare('UPDATE books SET name=?, current_amount=? WHERE id=? AND user_id=?').run(String(req.body.name || '').trim(), money(req.body.currentAmount), req.params.id, req.user.id);
  res.json({ ok: true });
});

app.delete('/api/books/:id', auth, (req, res) => {
  db.prepare('UPDATE books SET active=0 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/closes', auth, (req, res) => {
  const date = req.body.closeDate || dayjs().format('YYYY-MM-DD');
  const closes = Array.isArray(req.body.closes) ? req.body.closes : [];
  const tx = db.transaction(() => {
    for (const c of closes) {
      const amount = money(c.amount);
      db.prepare(`INSERT INTO closes(user_id,book_id,close_date,amount,note,created_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id,book_id,close_date) DO UPDATE SET amount=excluded.amount,note=excluded.note`)
        .run(req.user.id, c.bookId, date, amount, c.note || '', now());
      db.prepare('UPDATE books SET current_amount=? WHERE id=? AND user_id=?').run(amount, c.bookId, req.user.id);
    }
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/closes', auth, (req, res) => {
  const rows = db.prepare(`SELECT c.*, b.name book_name FROM closes c JOIN books b ON b.id=c.book_id WHERE c.user_id=? ORDER BY close_date DESC, book_name`).all(req.user.id);
  res.json({ closes: rows.map(r => ({ id:r.id, bookId:r.book_id, bookName:r.book_name, closeDate:r.close_date, amount:r.amount, note:r.note })) });
});

app.post('/api/bets', auth, (req, res) => {
  const b = req.body;
  const info = db.prepare('INSERT INTO bets(user_id,book_id,bet_date,sport,market,stake,profit,odds,result,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, b.bookId || null, b.betDate || dayjs().format('YYYY-MM-DD'), b.sport || '', b.market || '', money(b.stake), money(b.profit), b.odds || '', b.result || 'settled', b.note || '', now());
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/bets', auth, (req, res) => {
  const rows = db.prepare(`SELECT bets.*, books.name book_name FROM bets LEFT JOIN books ON books.id=bets.book_id WHERE bets.user_id=? ORDER BY bet_date DESC, id DESC LIMIT 500`).all(req.user.id);
  res.json({ bets: rows.map(r => ({ id:r.id, bookId:r.book_id, bookName:r.book_name, betDate:r.bet_date, sport:r.sport, market:r.market, stake:r.stake, profit:r.profit, odds:r.odds, result:r.result, note:r.note })) });
});

app.delete('/api/bets/:id', auth, (req, res) => {
  db.prepare('DELETE FROM bets WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/dashboard', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const books = db.prepare('SELECT * FROM books WHERE user_id=? AND active=1 ORDER BY name').all(req.user.id);
  const closes = db.prepare(`SELECT close_date, SUM(amount) total FROM closes WHERE user_id=? GROUP BY close_date ORDER BY close_date`).all(req.user.id);
  const bets = db.prepare('SELECT * FROM bets WHERE user_id=?').all(req.user.id);
  const current = money(books.reduce((s,b)=>s+b.current_amount,0));
  const start = money(user.starting_bankroll);
  const pnl = money(current - start);
  const roi = start ? money((pnl/start)*100) : 0;
  const totalStake = money(bets.reduce((s,b)=>s+b.stake,0));
  const betProfit = money(bets.reduce((s,b)=>s+b.profit,0));
  const betRoi = totalStake ? money((betProfit/totalStake)*100) : 0;
  const byBook = books.map(b => ({ name:b.name, amount:b.current_amount, pnl: money(b.current_amount - b.opening_amount) }));
  const bySportMap = {};
  for (const b of bets) { const k=b.sport||'Uncategorized'; bySportMap[k] ||= { sport:k, stake:0, profit:0, count:0 }; bySportMap[k].stake+=b.stake; bySportMap[k].profit+=b.profit; bySportMap[k].count++; }
  const bySport = Object.values(bySportMap).map(x => ({...x, stake:money(x.stake), profit:money(x.profit), roi:x.stake?money(x.profit/x.stake*100):0}));
  res.json({ metrics:{ startingBankroll:start, currentBankroll:current, netProfit:pnl, roi, sportsbookCount:books.length, betCount:bets.length, totalStake, betProfit, betRoi }, books: byBook, trend: closes, bySport });
});

app.get('/api/export/:type', auth, (req, res) => {
  const type = req.params.type;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const dash = JSON.parse(JSON.stringify({}));
  const books = db.prepare('SELECT name,opening_amount,current_amount FROM books WHERE user_id=? AND active=1 ORDER BY name').all(req.user.id);
  const closes = db.prepare(`SELECT c.close_date,b.name,c.amount,c.note FROM closes c JOIN books b ON b.id=c.book_id WHERE c.user_id=? ORDER BY c.close_date DESC,b.name`).all(req.user.id);
  const total = books.reduce((s,b)=>s+b.current_amount,0);
  const md = [`# Bankroll Report - ${user.handler}`, '', `Generated: ${new Date().toLocaleString()}`, '', `Starting bankroll: $${money(user.starting_bankroll)}`, `Current bankroll: $${money(total)}`, `Net P/L: $${money(total-user.starting_bankroll)}`, '', '## Sportsbooks', ...books.map(b=>`- ${b.name}: $${money(b.current_amount)} (opening $${money(b.opening_amount)})`), '', '## Recent closes', ...closes.slice(0,100).map(c=>`- ${c.close_date} | ${c.name}: $${money(c.amount)} ${c.note?`- ${c.note}`:''}`)].join('\n');
  if (type === 'json') return res.json({ handler:user.handler, books, closes });
  res.setHeader('Content-Type', type === 'txt' ? 'text/plain' : 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="bankroll-report.${type === 'txt' ? 'txt' : 'md'}"`);
  res.send(md);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Bankroll Tracker Pro running on ${PORT}`));
