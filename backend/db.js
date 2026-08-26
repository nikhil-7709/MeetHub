const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const databaseDirectory = path.join(__dirname, '..', 'database');
fs.mkdirSync(databaseDirectory, { recursive: true });

const dbPath = path.join(databaseDirectory, 'meeting_app.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log(`Connected to SQLite database at: ${dbPath}`);
  }
});

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  const sqlPath = path.join(databaseDirectory, 'meeting_app.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    db.exec(sql, (err) => {
      if (err) {
        console.error('Error initializing database schema:', err.message);
      } else {
        console.log('Database tables verified/initialized successfully.');
      }
    });
  }

  // Auto-migrate existing database files
  const columns = [
    "importance TEXT DEFAULT 'Medium'",
    "category TEXT DEFAULT 'General'",
    "meeting_link TEXT DEFAULT ''"
  ];
  columns.forEach(colDef => {
    db.run(`ALTER TABLE meetings ADD COLUMN ${colDef}`, () => {
      // Ignore duplicate column errors if already added
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

module.exports = { db, run, get, all, testConnection };