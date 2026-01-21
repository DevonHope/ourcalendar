const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const DATA_DIR = path.resolve(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true})
const DB_PATH = path.join(DATA_DIR, 'events.db')
const db = new Database(DB_PATH)
db.prepare(`CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER
)`).run()
console.log('Initialized DB at', DB_PATH)
