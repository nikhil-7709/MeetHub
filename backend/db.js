const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('sql.js');

const databaseDirectory = path.join(__dirname, '..', 'database');
const dbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), 'meeting_app.db')
  : path.join(databaseDirectory, 'meeting_app.db');
if (!process.env.VERCEL) fs.mkdirSync(databaseDirectory, { recursive: true });

let db;

const ready = initSqlJs({
  locateFile: file => require.resolve(`sql.js/dist/${file}`)
}).then(SQL => {
  const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  db = new SQL.Database(existing);
  db.run('PRAGMA foreign_keys = ON');

  const sqlPath = path.join(databaseDirectory, 'meeting_app.sql');
  const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
  db.exec(sql);
  console.log(`Connected to SQLite database at: ${dbPath}`);
  console.log('Database tables verified/initialized successfully.');
}).catch(error => {
  console.error('Error initializing database:', error);
  throw error;
});

function run(sql, params = []) {
  return ready.then(() => {
    db.run(sql, params);
    const row = db.exec('SELECT last_insert_rowid() AS id');
    return { id: row[0]?.values[0]?.[0] || 0, changes: db.getRowsModified() };
  });
}

function get(sql, params = []) {
  return ready.then(() => {
    const statement = db.prepare(sql);
    statement.bind(params);
    const row = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    return row;
  });
}

function all(sql, params = []) {
  return ready.then(() => {
    const statement = db.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
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

module.exports = { db: { close: () => db?.close() }, run, get, all, testConnection, ready };
