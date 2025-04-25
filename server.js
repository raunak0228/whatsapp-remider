const express = require('express');
const schedule = require('node-schedule');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Simple logging
const logger = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const errorLogger = (message, error) => console.error(`[ERROR ${new Date().toISOString()}] ${message}`, error);

// Twilio setup
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  errorLogger('Twilio credentials missing in .env file');
  process.exit(1);
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const fromNumber = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';

// Middleware
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Home Page
app.get('/home', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>📊 WhatsApp Sheet Scheduler</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
      <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js"></script>
      <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-auth-compat.js"></script>
      <script src="firebaseConfig.js"></script>
      <script>
      // Check authentication status
      firebase.auth().onAuthStateChanged((user) => {
        if (!user) {
          window.location.href = '/login';
        }
      });

      // Logout function
      async function logout() {
        try {
          await firebase.auth().signOut();
          localStorage.removeItem('idToken');
          window.location.href = '/login';
        } catch (error) {
          console.error('Logout error:', error);
        }
      }
      </script>
      <style>
        body {
          font-family: 'Outfit', sans-serif;
          background: linear-gradient(145deg, #0f2027, #203a43, #2c5364);
          color: #fff;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        .glass-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 20px;
          backdrop-filter: blur(15px);
          -webkit-backdrop-filter: blur(15px);
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          padding: 2rem;
          max-width: 600px;
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.18);
          animation: fadeIn 1.2s ease-in-out;
        }
        h1 {
          font-size: 2.5rem;
          font-weight: 700;
          background: -webkit-linear-gradient(#00c6ff, #0072ff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-align: center;
        }
        .btn-glow {
          background: linear-gradient(to right, #00c6ff, #0072ff);
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-weight: 600;
          color: #fff;
          width: 100%;
          transition: 0.3s ease;
          animation: glow 2s infinite alternate;
        }
        .btn-glow:hover {
          box-shadow: 0 0 20px rgba(0, 198, 255, 0.6);
          transform: scale(1.03);
        }
        .btn-danger {
          background: linear-gradient(to right, #ff416c, #ff4b2b);
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-weight: 600;
          color: #fff;
          width: 100%;
          transition: 0.3s ease;
        }
        .btn-danger:hover {
          box-shadow: 0 0 20px rgba(255, 65, 108, 0.6);
          transform: scale(1.03);
        }
        @keyframes glow {
          from { box-shadow: 0 0 5px #00c6ff; }
          to { box-shadow: 0 0 20px #0072ff; }
        }
        .info-list li {
          background-color: rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          margin-bottom: 10px;
          padding: 10px;
        }
        .form-control {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #fff;
          border-radius: 10px;
          padding: 0.75rem;
        }
        .form-control:focus {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(0, 198, 255, 0.5);
          color: #fff;
          box-shadow: 0 0 10px rgba(0, 198, 255, 0.2);
        }
        .form-control::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media screen and (max-width: 600px) {
          h1 { font-size: 2rem; }
        }
      </style>
    </head>
    <body>
      <div class="glass-card">
        <h1>📲 WhatsApp Scheduler</h1>
        <p class="text-center text-light mb-4">Send automated WhatsApp messages via <strong>Google Sheets</strong>.</p>
        
        <form action="/result" method="GET" class="mb-4">
          <div class="mb-3">
            <label for="sheetId" class="form-label">Google Sheet ID</label>
            <input type="text" class="form-control" id="sheetId" name="sheetId" placeholder="Enter your Google Sheet ID" required>
            <small class="text-light">You can find this in your Google Sheet URL: https://docs.google.com/spreadsheets/d/<strong>YOUR_SHEET_ID</strong>/edit</small>
          </div>
          <button type="submit" class="btn btn-glow">
            <i class="bi bi-send-fill"></i> Schedule Messages
          </button>
        </form>

        <h5 class="text-info mt-4 mb-2">📋 Required Columns:</h5>
        <ul class="info-list list-unstyled">
          <li>👤 <strong>Name</strong></li>
          <li>📱 <strong>Number</strong> (e.g. +91XXXXXXXXXX)</li>
          <li>💬 <strong>Message</strong></li>
          <li>🕒 <strong>Date</strong> (valid ISO format)</li>
          <li>📌 <strong>Status</strong> (auto-updated)</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// Test WhatsApp Message
app.post('/send-test', async (req, res) => {
  const { phoneNumber, message } = req.body;
  
  if (!phoneNumber || !message) {
    return res.send("❌ Phone number and message are required");
  }
  
  try {
    // Ensure proper formatting of phone number for WhatsApp
    const formattedNumber = phoneNumber.startsWith('whatsapp:') 
      ? phoneNumber 
      : `whatsapp:${phoneNumber}`;
    
    logger(`Sending test message to ${formattedNumber}`);
    
    const msg = await client.messages.create({
      body: message,
      from: fromNumber,
      to: formattedNumber,
    });
    
    logger(`Test message sent: ${msg.sid}`);
    res.send(`
      <div style="padding: 20px; font-family: sans-serif;">
        ✅ Test message sent successfully!<br/>
        Message SID: ${msg.sid}<br/><br/>
        <a href="/">⏪ Back to Home</a>
      </div>
    `);
  } catch (error) {
    errorLogger(`Failed to send test message: ${error.message}`, error);
    res.send(`
      <div style="padding: 20px; font-family: sans-serif;">
        ❌ Failed to send message: ${error.message}<br/><br/>
        <a href="/">⏪ Back to Home</a>
      </div>
    `);
  }
});

// Google Sheet Scheduler Route
app.get('/result', async (req, res) => {
  const sheetId = req.query.sheetId;
  
  if (!sheetId) {
    return res.redirect('/result?status=error&message=Google Sheet ID is required');
  }

  const credsPath = path.join(__dirname, 'credentials.json');

  if (!fs.existsSync(credsPath)) {
    return res.redirect('/result?status=error&message=Google Sheets credentials file missing');
  }

  // Tracking stats
  let scheduled = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Load Google credentials
    const creds = require(credsPath);
    const doc = new GoogleSpreadsheet(sheetId);

    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });
    
    await doc.loadInfo();
    logger(`Connected to spreadsheet: ${doc.title}`);

    // Get rows from the first sheet
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    logger(`Fetched ${rows.length} rows from the sheet`);

    // Process each row
    for (const row of rows) {
      try {
        const name = row.Name || '';
        const phoneNumber = row.Number;
        const message = row.Message;
        const dateTime = row.Date;

        // Validate required fields
        if (!phoneNumber || !message || !dateTime) {
          logger(`Skipping row - missing required fields for ${name || 'unnamed'}`);
          skipped++;
          continue;
        }

        const scheduledTime = new Date(dateTime);
        
        // Validate date
        if (isNaN(scheduledTime.getTime())) {
          logger(`Invalid date format for ${name}: ${dateTime}`);
          skipped++;
          continue;
        }

        // Skip past dates
        if (scheduledTime < new Date()) {
          logger(`Skipping past date for ${name}: ${scheduledTime.toISOString()}`);
          skipped++;
          continue;
        }

        // Schedule the job
        const job = schedule.scheduleJob(scheduledTime, async function() {
          try {
            logger(`Sending scheduled message to ${name} (${phoneNumber})`);
            
            const msg = await client.messages.create({
              body: message,
              from: fromNumber,
              to: `whatsapp:${phoneNumber}`,
            });
            
            logger(`Message sent successfully to ${name}: ${msg.sid}`);
          } catch (err) {
            errorLogger(`Failed to send message to ${phoneNumber}:`, err);
          }
        });

        if (job) {
          scheduled++;
          logger(`Job scheduled for ${name} at ${scheduledTime.toISOString()}`);
        } else {
          failed++;
          logger(`Failed to schedule job for ${name}`);
        }
      } catch (err) {
        errorLogger('Error processing row:', err);
        failed++;
      }
    }

    // Redirect to result page with success data
    res.redirect(`/result?scheduled=${scheduled}&skipped=${skipped}&failed=${failed}`);
  } catch (error) {
    errorLogger('Error processing Google Sheet:', error);
    res.redirect(`/result?status=error&message=${encodeURIComponent(error.message)}`);
  }
});

// Verify Firebase Token
app.post('/verify-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'No token provided' });
    }

    // Verify the token with Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    if (decodedToken) {
      res.json({ success: true, uid: decodedToken.uid });
    } else {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ success: false, message: 'Token verification failed' });
  }
});

// Logout Route
app.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.redirect('/login');
});

// Start Server
app.listen(PORT, () => {
  logger(`🚀 Server running at http://localhost:${PORT}`);
});