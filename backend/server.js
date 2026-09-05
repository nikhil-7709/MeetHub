const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const db = require('./db');

// Determine LAN IP address for invite links
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
const localIp = getLocalIp();

const app = express();
const port = process.env.PORT || 3000;
const sessions = new Map();

app.use(cors());
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database initialization failed.' });
  }
});
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function auth(req, res, next) {
  const userId = sessions.get(req.header('authorization'));
  if (!userId) return res.status(401).json({ error: 'Please sign in first.' });
  req.userId = userId;
  next();
}

// Database and API Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbConnected = await db.testConnection();
  if (dbConnected) {
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } else {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Server network info — lets the frontend build real cross-device invite links
app.get('/api/server-info', (req, res) => {
  res.json({ ip: localIp, port });
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Name, email, and a 6-character password are required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const result = await db.run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [cleanName, cleanEmail, hashPassword(password)]
    );
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, result.id);
    res.status(201).json({ token, user: { id: result.id, name: cleanName, email: cleanEmail } });
  } catch (error) {
    res.status(409).json({ error: error.message.includes('UNIQUE') ? 'That email is already registered.' : 'Could not create account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      [String(req.body.email || '').trim().toLowerCase()]
    );
    if (!user || user.password_hash !== hashPassword(String(req.body.password || ''))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await db.get('SELECT id, name, email FROM users WHERE id = ?', [req.userId]);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch user profile.' });
  }
});

app.get('/api/meetings', auth, async (req, res) => {
  try {
    const meetings = await db.all(`
      SELECT m.*, u.name AS host_name,
      (SELECT COUNT(*) FROM participants p WHERE p.meeting_id = m.id) AS participant_count
      FROM meetings m JOIN users u ON u.id = m.host_id
      WHERE m.host_id = ? OR m.id IN (SELECT meeting_id FROM participants WHERE user_id = ?)
      ORDER BY m.starts_at DESC
    `, [req.userId, req.userId]);
    res.json(meetings);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch meetings.' });
  }
});

app.post('/api/meetings', auth, async (req, res) => {
  try {
    const { title, description = '', startsAt, importance = 'Medium', category = 'General', meetingLink = '' } = req.body;
    if (!title || !startsAt) return res.status(400).json({ error: 'Title and start time are required.' });
    const cleanImportance = ['High', 'Medium', 'Low'].includes(importance) ? importance : 'Medium';
    const meeting = await db.run(
      'INSERT INTO meetings (title, description, host_id, starts_at, importance, category, meeting_link) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title.trim(), description.trim(), req.userId, startsAt, cleanImportance, category.trim() || 'General', meetingLink.trim()]
    );
    await db.run('INSERT INTO participants (meeting_id, user_id) VALUES (?, ?)', [meeting.id, req.userId]);
    res.status(201).json({ id: meeting.id });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Could not create meeting.' });
  }
});

app.get('/api/meetings/:id', auth, async (req, res) => {
  try {
    // Fetch meeting (any authenticated user can open it via invite link)
    const meeting = await db.get(`
      SELECT m.*, u.name AS host_name FROM meetings m JOIN users u ON u.id = m.host_id
      WHERE m.id = ?
    `, [req.params.id]);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    // Auto-join user as participant if not already one
    const existing = await db.get('SELECT 1 FROM participants WHERE meeting_id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!existing) {
      await db.run('INSERT INTO participants (meeting_id, user_id) VALUES (?, ?)', [req.params.id, req.userId]);
    }

    const messages = await db.all(`
      SELECT x.*, u.name FROM messages x JOIN users u ON u.id = x.user_id WHERE meeting_id = ? ORDER BY x.created_at ASC
    `, [req.params.id]);

    res.json({ meeting, messages });
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch meeting details.' });
  }
});

app.post('/api/meetings/:id/messages', auth, async (req, res) => {
  try {
    const member = await db.get('SELECT 1 FROM participants WHERE meeting_id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!member) return res.status(403).json({ error: 'Join the meeting before posting.' });
    if (!req.body.body?.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });

    const result = await db.run(
      'INSERT INTO messages (meeting_id, user_id, body) VALUES (?, ?, ?)',
      [req.params.id, req.userId, req.body.body.trim()]
    );
    const message = await db.get(
      'SELECT x.*, u.name FROM messages x JOIN users u ON u.id = x.user_id WHERE x.id = ?',
      [result.id]
    );
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Could not post message.' });
  }
});

// WebRTC Signaling endpoints for live video calls across devices
const roomSignals = new Map();

app.post('/api/meetings/:id/signal', auth, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const { targetId, type, payload } = req.body;
    const user = await db.get('SELECT name FROM users WHERE id = ?', [req.userId]);

    if (!roomSignals.has(meetingId)) {
      roomSignals.set(meetingId, []);
    }

    const signals = roomSignals.get(meetingId);
    const signalItem = {
      id: Date.now() + Math.random().toString(36).substring(2, 7),
      senderId: req.userId,
      senderName: user ? user.name : 'Participant',
      targetId: targetId || null,
      type,
      payload,
      timestamp: Date.now()
    };

    signals.push(signalItem);

    // Keep only last 100 signals and remove signals older than 2 minutes
    const twoMinutesAgo = Date.now() - 120000;
    roomSignals.set(meetingId, signals.filter(s => s.timestamp > twoMinutesAgo).slice(-100));

    res.status(201).json({ success: true, signalId: signalItem.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post WebRTC signal.' });
  }
});

app.get('/api/meetings/:id/signal', auth, async (req, res) => {
  try {
    const meetingId = req.params.id;
    const since = parseInt(req.query.since || '0', 10);
    const signals = roomSignals.get(meetingId) || [];

    const newSignals = signals.filter(s =>
      s.timestamp > since &&
      s.senderId !== req.userId &&
      (s.targetId === null || s.targetId === req.userId)
    );

    res.json({ signals: newSignals, now: Date.now() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WebRTC signals.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`\n✅ MeetHub server started!`);
    console.log(`   Local:   http://localhost:${port}`);
    console.log(`   Network: http://${localIp}:${port}  ← share this with other devices\n`);
    db.testConnection().then(connected => {
      if (connected) {
        console.log('Database connection verified successfully on server start.');
      } else {
        console.error('Warning: Database connection verification failed on server start.');
      }
    });
  });

  server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${port} is already in use!`);
    console.log(`Another process (or an earlier instance of server.js) is already running on port ${port}.\n`);
    console.log('To run on a different port:');
    console.log('  PowerShell:  $env:PORT=3001; npm start');
    console.log('  CMD:         set PORT=3001 && npm start');
    console.log('\nTo stop the process using port 3000 on Windows:');
    console.log('  Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force\n');
    process.exit(1);
  } else {
    throw err;
  }
  });
}

module.exports = app;


