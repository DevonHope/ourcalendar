const express = require('express')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const bodyParser = require('body-parser')
const cors = require('cors')
const crypto = require('crypto')
const argon2 = require('argon2')

const DATA_DIR = path.resolve(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = path.join(DATA_DIR, 'events.db')
const db = new Database(DB_PATH)

// create tables if not exists
db.prepare(`CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER
)`).run()

// events table with optional calendar_id and description; add columns if needed
db.prepare(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER,
  calendar_id INTEGER,
  description TEXT
)`).run()

db.prepare(`CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  email TEXT,
  created_at INTEGER
)`).run()

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT,
  name TEXT,
  photo TEXT,
  birthday TEXT
)`).run()

// ensure any existing DB gets the new columns if they were added later
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
if (!userCols.includes('name')) db.prepare('ALTER TABLE users ADD COLUMN name TEXT').run()
if (!userCols.includes('photo')) db.prepare('ALTER TABLE users ADD COLUMN photo TEXT').run()
if (!userCols.includes('birthday')) db.prepare('ALTER TABLE users ADD COLUMN birthday TEXT').run()

// insert default users if not exist, include profile defaults
db.prepare('INSERT OR IGNORE INTO users (username, password, name, photo, birthday) VALUES (?,?,?,?,?)').run('devon', '', 'Devon', '', '')
db.prepare('INSERT OR IGNORE INTO users (username, password, name, photo, birthday) VALUES (?,?,?,?,?)').run('maddy', '', 'Maddy', '', '')

// ensure calendar columns for defaults exist
const calCols = db.prepare("PRAGMA table_info(calendars)").all().map(c => c.name)
if (!calCols.includes('default_reminder')) db.prepare('ALTER TABLE calendars ADD COLUMN default_reminder INTEGER').run()
if (!calCols.includes('default_repeat')) db.prepare('ALTER TABLE calendars ADD COLUMN default_repeat TEXT').run()
if (!calCols.includes('default_timezone')) db.prepare('ALTER TABLE calendars ADD COLUMN default_timezone TEXT').run()

// ensure events have default columns for reminders, repeat, timezone
const eventCols = db.prepare("PRAGMA table_info(events)").all().map(c => c.name)
if (!eventCols.includes('reminder')) db.prepare('ALTER TABLE events ADD COLUMN reminder INTEGER').run()
if (!eventCols.includes('repeat')) db.prepare('ALTER TABLE events ADD COLUMN repeat TEXT').run()
if (!eventCols.includes('timezone')) db.prepare('ALTER TABLE events ADD COLUMN timezone TEXT').run()

const app = express()
app.use(cors())
app.use(bodyParser.json())

// encryption key: base64-encoded 32 bytes in env OURCALENDAR_ENC_KEY
function ensureEncKey(){
  // try to load from existing env var
  let keyB64 = process.env.OURCALENDAR_ENC_KEY

  // attempt to load server/.env if present (simple parser, no external deps)
  try {
    const envPath = path.join(__dirname, '.env')
    if (!keyB64 && fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
      for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const k = m[1]
        let v = m[2]
        // strip surrounding quotes
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1,-1)
        if (!process.env[k]) process.env[k] = v
      }
      keyB64 = process.env.OURCALENDAR_ENC_KEY
    }
  } catch (e) {
    console.warn('Could not read server/.env:', e && e.message)
  }

  // if still not present, generate one and persist it into server/.env
  if (!keyB64) {
    const newKey = crypto.randomBytes(32).toString('base64')
    const envPath = path.join(__dirname, '.env')
    try {
      // append or create .env with the key
      let data = ''
      if (fs.existsSync(envPath)) data = fs.readFileSync(envPath, 'utf8')
      // avoid duplicating the key if file already contains it
      if (!/OURCALENDAR_ENC_KEY\s*=/.test(data)) {
        if (data && !data.endsWith('\n')) data += '\n'
        data += `OURCALENDAR_ENC_KEY=${newKey}\n`
        fs.writeFileSync(envPath, data, { mode: 0o600 })
        console.log('Generated encryption key and wrote to', envPath)
      }
      process.env.OURCALENDAR_ENC_KEY = newKey
      keyB64 = newKey
    } catch (e) {
      console.error('Failed to write server/.env:', e && e.message)
      // fallthrough to error out below
    }
  }

  if (!keyB64) {
    console.error('\nERROR: OURCALENDAR_ENC_KEY environment variable is not set.')
    console.error('Generate one with:')
    console.error("  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"")
    console.error('and set it in your environment (export OURCALENDAR_ENC_KEY=...)')
    throw new Error('Missing OURCALENDAR_ENC_KEY')
  }

  const buf = Buffer.from(keyB64, 'base64')
  if (buf.length !== 32) throw new Error('OURCALENDAR_ENC_KEY must be a base64-encoded 32 byte key')
  return buf
}
const ENC_KEY = ensureEncKey()

function isEncryptedStr(s){ return typeof s === 'string' && s.startsWith('enc:v1:') }
function encryptString(plaintext){ if (plaintext == null) return plaintext; const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv); const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]); const tag = cipher.getAuthTag(); return `enc:v1:${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}` }
function decryptString(s){ if (s == null || !isEncryptedStr(s)) return s; try{ const payload = s.slice('enc:v1:'.length); const [ivB64, ctB64, tagB64] = payload.split('.'); const iv = Buffer.from(ivB64, 'base64'); const ct = Buffer.from(ctB64, 'base64'); const tag = Buffer.from(tagB64, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv); decipher.setAuthTag(tag); const pt = Buffer.concat([decipher.update(ct), decipher.final()]); return pt.toString('utf8') } catch (err) { console.error('Failed to decrypt value:', err); return s }
}

// password helpers
async function hashPassword(pw){ if (pw == null) return null; return await argon2.hash(String(pw), { type: argon2.argon2id, memoryCost: 1<<16, timeCost: 3, parallelism: 1 }) }
async function verifyPassword(hash, pw){ try { return await argon2.verify(hash, String(pw || '')) } catch(e) { return false } }

// migration: backup DB and encrypt/hash fields as needed
async function runMigrations(){
  const backupPath = DB_PATH + '.bak.' + Date.now()
  try {
    fs.copyFileSync(DB_PATH, backupPath)
    console.log('Database backup created at', backupPath)
  } catch (e) {
    console.warn('Could not create DB backup:', e)
  }

  // users: hash passwords and encrypt profile fields
  const users = db.prepare('SELECT id, password, name, photo, birthday FROM users').all()
  const userUpdates = []
  for (const u of users){
    const upd = {}
    if (typeof u.password !== 'undefined' && u.password !== null && !String(u.password).startsWith('$argon2')){
      upd.password = await hashPassword(u.password)
    }
    if (u.name && !isEncryptedStr(u.name)) upd.name = encryptString(u.name)
    if (u.photo && !isEncryptedStr(u.photo)) upd.photo = encryptString(u.photo)
    if (u.birthday && !isEncryptedStr(u.birthday)) upd.birthday = encryptString(u.birthday)
    if (Object.keys(upd).length) userUpdates.push({ id: u.id, upd })
  }
  if (userUpdates.length){
    console.log('Applying', userUpdates.length, 'user updates (hashing/encrypting)')
    const stmt = db.prepare('UPDATE users SET password = COALESCE(?, password), name = COALESCE(?, name), photo = COALESCE(?, photo), birthday = COALESCE(?, birthday) WHERE id = ?')
    db.transaction(()=>{
      for (const u of userUpdates) {
        stmt.run(u.upd.password || null, u.upd.name || null, u.upd.photo || null, u.upd.birthday || null, u.id)
      }
    })()
  }

  // events: encrypt title and description
  const events = db.prepare('SELECT id, title, description FROM events').all()
  const evUpdates = []
  for (const e of events){
    const upd = {}
    if (e.title && !isEncryptedStr(e.title)) upd.title = encryptString(e.title)
    if (e.description && !isEncryptedStr(e.description)) upd.description = encryptString(e.description)
    if (Object.keys(upd).length) evUpdates.push({ id: e.id, upd })
  }
  if (evUpdates.length){
    console.log('Applying', evUpdates.length, 'event updates (encrypting)')
    const stmt = db.prepare('UPDATE events SET title = COALESCE(?, title), description = COALESCE(?, description) WHERE id = ?')
    db.transaction(()=>{
      for (const e of evUpdates) stmt.run(e.upd.title || null, e.upd.description || null, e.id)
    })()
  }
}

// simple APIs
// list events with optional filters: calendar_id, from, to, limit
app.get('/api/events', (req, res) => {
  const { calendar_id, from, to, limit } = req.query
  let sql = 'SELECT id,title,start,end,calendar_id,description,reminder,repeat,timezone FROM events'
  const where = []
  const params = []
  if (calendar_id) { where.push('calendar_id = ?'); params.push(parseInt(calendar_id,10)) }
  if (from) { where.push('start >= ?'); params.push(parseInt(from,10)) }
  if (to) { where.push('start <= ?'); params.push(parseInt(to,10)) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY start ASC'
  if (limit) sql += ' LIMIT ' + parseInt(limit,10)
  const rows = db.prepare(sql).all(...params)
  // decrypt sensitive fields before returning
  const out = rows.map(r => ({ ...r, title: decryptString(r.title), description: decryptString(r.description) }))
  res.json(out)
})

app.post('/api/events', (req, res) => {
  const { title, start, end, calendar_id, description, reminder, repeat, timezone } = req.body || {}
  // basic validation
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required' })
  if (start == null || Number.isNaN(Number(start))) return res.status(400).json({ error: 'start timestamp is required and must be a number' })
  const startTs = Number(start)
  const endTs = end == null ? null : Number(end)
  if (endTs !== null && Number.isNaN(endTs)) return res.status(400).json({ error: 'end must be a number or omitted' })
  if (endTs !== null && endTs < startTs) return res.status(400).json({ error: 'end must be >= start' })

  const calId = calendar_id == null ? null : Number(calendar_id)
  if (calId === null) {
    const row = db.prepare('SELECT COUNT(*) as c FROM calendars').get()
    const count = row && row.c ? row.c : 0
    if (count === 0) return res.status(400).json({ error: 'No calendars exist; create a calendar before adding events' })
  }

  // determine defaults from calendar if needed
  let rem = typeof reminder !== 'undefined' ? (reminder == null ? null : Number(reminder)) : null
  let rep = typeof repeat !== 'undefined' ? repeat : null
  let tz = typeof timezone !== 'undefined' ? timezone : null
  if (calId !== null) {
    const cal = db.prepare('SELECT default_reminder, default_repeat, default_timezone FROM calendars WHERE id = ?').get(calId)
    if (cal) {
      if (rem === null && cal.default_reminder != null) rem = cal.default_reminder
      if (!rep && cal.default_repeat) rep = cal.default_repeat
      if (!tz && cal.default_timezone) tz = cal.default_timezone
    }
  }

  const encTitle = encryptString(title)
  const encDesc = description ? encryptString(description) : null

  const stmt = db.prepare('INSERT INTO events (title,start,end,calendar_id,description,reminder,repeat,timezone) VALUES (?,?,?,?,?,?,?,?)')
  const info = stmt.run(encTitle, startTs, endTs || null, calId || null, encDesc, rem || null, rep || null, tz || null)
  res.json({ id: info.lastInsertRowid, title, start: startTs, end: endTs, calendar_id: calId, description, reminder: rem, repeat: rep, timezone: tz })
})

app.put('/api/events/:id', (req, res) => {
  const id = parseInt(req.params.id,10)
  const { title, start, end, calendar_id, description, reminder, repeat, timezone } = req.body
  const encTitle = typeof title !== 'undefined' ? encryptString(title) : undefined
  const encDesc = typeof description !== 'undefined' ? (description ? encryptString(description) : null) : undefined

  db.prepare('UPDATE events SET title = COALESCE(?, title), start = COALESCE(?, start), end = COALESCE(?, end), calendar_id = COALESCE(?, calendar_id), description = COALESCE(?, description), reminder = COALESCE(?, reminder), repeat = COALESCE(?, repeat), timezone = COALESCE(?, timezone) WHERE id = ?')
    .run(encTitle, start, end || null, calendar_id || null, encDesc, typeof reminder !== 'undefined' ? (reminder == null ? null : Number(reminder)) : undefined, typeof repeat !== 'undefined' ? repeat : undefined, typeof timezone !== 'undefined' ? timezone : undefined, id)
  const row = db.prepare('SELECT id,title,start,end,calendar_id,description,reminder,repeat,timezone FROM events WHERE id = ?').get(id)
  // decrypt
  row.title = decryptString(row.title)
  row.description = decryptString(row.description)
  res.json(row)
})

app.delete('/api/events/:id', (req, res) => {
  const id = parseInt(req.params.id,10)
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
  res.json({ ok: true })
})

// calendars
app.get('/api/calendars', (req, res) => {
  const rows = db.prepare('SELECT id,name,color,created_at,default_reminder,default_repeat,default_timezone FROM calendars ORDER BY id ASC').all()
  res.json(rows)
})

app.post('/api/calendars', (req, res) => {
  const { name, color, default_reminder, default_repeat, default_timezone } = req.body
  const stmt = db.prepare('INSERT INTO calendars (name,color,default_reminder,default_repeat,default_timezone,created_at) VALUES (?,?,?,?,?,?)')
  const info = stmt.run(name, color || null, typeof default_reminder !== 'undefined' ? default_reminder : null, default_repeat || null, default_timezone || null, Date.now())
  const row = db.prepare('SELECT id,name,color,created_at,default_reminder,default_repeat,default_timezone FROM calendars WHERE id = ?').get(info.lastInsertRowid)
  res.json(row)
})

app.put('/api/calendars/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { name, color, default_reminder, default_repeat, default_timezone } = req.body || {}
  const updates = []
  const params = []
  if (typeof name !== 'undefined') { updates.push('name = ?'); params.push(name) }
  if (typeof color !== 'undefined') { updates.push('color = ?'); params.push(color) }
  if (typeof default_reminder !== 'undefined') { updates.push('default_reminder = ?'); params.push(default_reminder == null ? null : Number(default_reminder)) }
  if (typeof default_repeat !== 'undefined') { updates.push('default_repeat = ?'); params.push(default_repeat) }
  if (typeof default_timezone !== 'undefined') { updates.push('default_timezone = ?'); params.push(default_timezone) }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' })
  params.push(id)
  const sql = 'UPDATE calendars SET ' + updates.join(', ') + ' WHERE id = ?'
  db.prepare(sql).run(...params)
  const row = db.prepare('SELECT id,name,color,created_at,default_reminder,default_repeat,default_timezone FROM calendars WHERE id = ?').get(id)
  res.json(row)
})

app.delete('/api/calendars/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  // unassign events from this calendar
  db.prepare('UPDATE events SET calendar_id = NULL WHERE calendar_id = ?').run(id)
  // remove any shares
  db.prepare('DELETE FROM shares WHERE calendar_id = ?').run(id)
  db.prepare('DELETE FROM calendars WHERE id = ?').run(id)
  res.json({ ok: true })
})

// login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username) return res.status(400).json({ error: 'username required' })
  const userRow = db.prepare('SELECT id, username, password, name, photo, birthday FROM users WHERE username = ?').get(username)
  if (!userRow) return res.status(401).json({ error: 'Invalid credentials' })
  const ok = await verifyPassword(userRow.password || '', password || '')
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  const user = { id: userRow.id, username: userRow.username, name: decryptString(userRow.name), photo: decryptString(userRow.photo), birthday: decryptString(userRow.birthday) }
  res.json({ user })
})

// update user profile
app.put('/api/user', async (req, res) => {
  const { id, name, photo, birthday, password } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id is required' })
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'User not found' })

  const updates = []
  const params = []
  if (typeof name !== 'undefined') { updates.push('name = ?'); params.push(name ? encryptString(name) : null) }
  if (typeof photo !== 'undefined') { updates.push('photo = ?'); params.push(photo ? encryptString(photo) : null) }
  if (typeof birthday !== 'undefined') { updates.push('birthday = ?'); params.push(birthday ? encryptString(birthday) : null) }
  if (typeof password !== 'undefined') { updates.push('password = ?'); params.push(await hashPassword(password)) }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' })
  params.push(id)
  const sql = 'UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?'
  db.prepare(sql).run(...params)
  const userRow = db.prepare('SELECT id,username,name,photo,birthday FROM users WHERE id = ?').get(id)
  const user = { id: userRow.id, username: userRow.username, name: decryptString(userRow.name), photo: decryptString(userRow.photo), birthday: decryptString(userRow.birthday) }
  res.json({ user })
})

// import: accept a JSON array of events or a url (stub)
app.post('/api/import', async (req, res) => {
  const { url, events, calendar_id } = req.body || {}
  const created = []
  if (Array.isArray(events)) {
    const stmt = db.prepare('INSERT INTO events (title,start,end,calendar_id,description,reminder,repeat,timezone) VALUES (?,?,?,?,?,?,?,?)')
    const insertMany = db.transaction((evs) => {
      for (const ev of evs) {
        const info = stmt.run(encryptString(ev.title), ev.start, ev.end || null, calendar_id || null, ev.description ? encryptString(ev.description) : null, ev.reminder || null, ev.repeat || null, ev.timezone || null)
        created.push({ id: info.lastInsertRowid, ...ev })
      }
    })
    insertMany(events)
    return res.json({ imported: created.length, created })
  }

  if (url) {
    return res.json({ imported: 0, warning: 'Import from URL is a stub in this minimal server; provide events array instead.' })
  }

  res.status(400).json({ error: 'No events or url provided' })
})

// share calendar: create a token and (optionally) pretend to email it
app.post('/api/share', (req, res) => {
  const { calendar_id, email } = req.body || {}
  if (!calendar_id) return res.status(400).json({ error: 'calendar_id required' })
  const token = Math.random().toString(36).slice(2,10)
  const info = db.prepare('INSERT INTO shares (calendar_id,token,email,created_at) VALUES (?,?,?,?)').run(calendar_id, token, email || null, Date.now())
  // prefer a configured public host, otherwise default to ourcalendar.ca
  const baseHost = 'https://ourcalendar.ca'
  const link = `${baseHost}/share/${token}`
  // In a real app we might email; here we just return the link
  res.json({ link, token, email })
})

const port = process.env.PORT || 5913

// start the server after running migrations
;(async ()=>{
  try {
    await runMigrations()
    app.listen(port, () => console.log(`ourcalendar server listening on ${port} (db: ${DB_PATH})`))
  } catch (err) {
    console.error('Failed to start server due to migration/startup error:', err)
    process.exit(1)
  }
})()
