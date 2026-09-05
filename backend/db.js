const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const databaseDirectory = path.join(__dirname, '..', 'database');
const dbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), 'meeting_app.db')
  : path.join(databaseDirectory, 'meeting_app.db');
if (!process.env.VERCEL) fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log(`Connected to SQLite database at: ${dbPath}`);
  }
});

const ready = new Promise((resolve, reject) => {
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    const sqlPath = path.join(databaseDirectory, 'meeting_app.sql');
    const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
    db.exec(sql, (err) => {
      if (err) {
        console.error('Error initializing database schema:', err.message);
        reject(err);
        return;
      }

      const columns = [
        "importance TEXT DEFAULT 'Medium'",
        "category TEXT DEFAULT 'General'",
        "meeting_link TEXT DEFAULT ''"
      ];
      let index = 0;
      const migrateNext = () => {
        if (index === columns.length) {
          console.log('Database tables verified/initialized successfully.');
          resolve();
          return;
        }
        db.run(`ALTER TABLE meetings ADD COLUMN ${columns[index++]}`, migrateNext);
      };
      migrateNext();
    });
  });
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function testConnection() {
  try {
    const row = await get('SELECT 1 AS result');
    return row && row.result === 1;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
}

module.exports = { db, run, get, all, testConnection, ready };
