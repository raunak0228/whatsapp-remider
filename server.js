const express = require('express');
const schedule = require('node-schedule');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Add authentication middleware
const checkAuth = async (req, res, next) => {
  try {
    const idToken = req.cookies?.session || req.headers.authorization?.split('Bearer ')[1];
    
    if (!idToken) {
      return res.redirect('/login');
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect('/login');
  }
};

// Add caching configuration
const CACHE = {
  sheets: new Map(),
  ttl: 5 * 60 * 1000, // 5 minutes
  processing: new Set() // Track sheets being processed
};

// Initialize logging functions
const logger = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
const errorLogger = (message, error) => console.error(`[ERROR ${new Date().toISOString()}] ${message}`, error);

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Load Google credentials from environment variable or file
let googleCredentials;
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    // Parse the credentials from environment variable
    googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    logger('Loaded Google credentials from environment variable');
    
    // Ensure private key is properly formatted
    if (googleCredentials.private_key) {
      // Replace escaped newlines with actual newlines
      googleCredentials.private_key = googleCredentials.private_key.replace(/\\n/g, '\n');
      
      // Verify the private key format
      if (!googleCredentials.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('Invalid private key format in environment variable');
      }
    } else {
      throw new Error('Private key missing in environment variable');
    }
  } else {
    const credsPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credsPath)) {
      throw new Error('Google credentials not found in environment or file');
    }
    googleCredentials = require(credsPath);
    logger('Loaded Google credentials from file');
    
    // Format private key from file
    if (googleCredentials.private_key) {
      googleCredentials.private_key = googleCredentials.private_key.replace(/\\n/g, '\n');
    }
  }

  // Validate required fields
  if (!googleCredentials.client_email || !googleCredentials.private_key) {
    throw new Error('Missing required fields in Google credentials');
  }

  // Log the client email (but not the private key) for debugging
  logger(`Using Google service account: ${googleCredentials.client_email}`);
} catch (error) {
  errorLogger('Failed to load Google credentials:', error);
  process.exit(1);
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Twilio setup
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  errorLogger('Twilio credentials missing in .env file');
  process.exit(1);
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const fromNumber = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';

// Middleware
app.use(cookieParser());
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

// Home Page - Protected route
app.get('/home', checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
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

// Helper function to get cached sheet data
async function getSheetData(sheetId) {
  const now = Date.now();
  const cached = CACHE.sheets.get(sheetId);
  
  // Clear cache if sheet is being processed
  if (CACHE.processing.has(sheetId)) {
    CACHE.sheets.delete(sheetId);
  }
  
  // If not cached or cache expired, fetch new data
  if (!cached || (now - cached.timestamp) >= CACHE.ttl) {
    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useServiceAccountAuth({
      client_email: googleCredentials.client_email,
      private_key: googleCredentials.private_key,
    });
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    const data = { doc, sheet, rows };
    CACHE.sheets.set(sheetId, {
      data,
      timestamp: now
    });
    
    return data;
  }
  
  logger('Using cached sheet data');
  return cached.data;
}

// Result Page - Protected route
app.get('/result', checkAuth, async (req, res) => {
  const sheetId = req.query.sheetId;
  const status = req.query.status;
  const message = req.query.message;

  if (!sheetId) {
    return res.redirect('/result?status=error&message=Google Sheet ID is required');
  }

  // If this is just a status check, return the result page
  if (status) {
    return res.sendFile(path.join(__dirname, 'public', 'result.html'));
  }

  // Check if sheet is already being processed
  if (CACHE.processing.has(sheetId)) {
    logger(`Sheet ${sheetId} is already being processed`);
    return res.redirect(`/result?status=processing&sheetId=${sheetId}`);
  }

  try {
    // Clear any existing cache for this sheet
    CACHE.sheets.delete(sheetId);
    
    // Mark sheet as being processed
    CACHE.processing.add(sheetId);
    
    const { doc, sheet, rows } = await getSheetData(sheetId);
    logger(`Connected to spreadsheet: ${doc.title}`);
    logger(`Fetched ${rows.length} rows from the sheet`);

    // Process each row
    let scheduled = 0;
    let failed = 0;
    let skipped = 0;

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

    // Remove from processing set
    CACHE.processing.delete(sheetId);
    
    return res.redirect(`/result?status=success&message=Successfully processed ${rows.length} rows&sheetId=${sheetId}&scheduled=${scheduled}&skipped=${skipped}&failed=${failed}`);
  } catch (error) {
    // Remove from processing set on error
    CACHE.processing.delete(sheetId);
    
    errorLogger('Error processing Google Sheet:', error);
    return res.redirect(`/result?status=error&message=${encodeURIComponent(error.message)}&sheetId=${sheetId}`);
  }
});

// Login route
app.post('/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Set session cookie
    res.cookie('session', idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
});

// Logout route
app.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.redirect('/login');
});

// Start Server
app.listen(PORT, () => {
  logger(`🚀 Server running at http://localhost:${PORT}`);
});