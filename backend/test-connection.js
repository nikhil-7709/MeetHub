const db = require('./db');

async function main() {
  console.log('--- Testing API and Database Connection ---');
  
  const connected = await db.testConnection();
  if (!connected) {
    console.error('❌ Failed to connect to database.');
    process.exit(1);
  }
  console.log('✅ Database connection test query succeeded.');

  try {
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('✅ Found database tables:', tables.map(t => t.name).join(', '));

    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users count in DB: ${userCount.count}`);

    const meetingCount = await db.get('SELECT COUNT(*) as count FROM meetings');
    console.log(`✅ Meetings count in DB: ${meetingCount.count}`);

    console.log('--- Database Connection Verification Passed Successfully! ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error testing database queries:', err);
    process.exit(1);
  }
}

main();
