const express = require('express');
const cors = require('cors');
const { BrevoClient } = require('@getbrevo/brevo');
const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app'); // <-- FIXED: Clean direct import for credential logic
const { getDatabase } = require('firebase-admin/database'); // <-- FIXED: Added correct modular import for Database

const app = express();

// 1. Enable CORS securely for your frontend
app.use(cors({
  origin: '*', // Once live, you can replace '*' with your actual GitHub Pages URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// 2. Initialize Firebase Admin securely using Render Environment Variables
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: cert(serviceAccount), // <-- FIXED: Uses the secure in-memory credential setup (No files required!)
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log("Firebase Admin securely connected!");
  } catch (error) {
    console.error("Firebase Admin initialization failed:", error);
  }
} else {
  console.warn("WARNING: FIREBASE_SERVICE_ACCOUNT env variable is missing!");
}

// 3. Initialize Brevo Client securely
const BREVO_API_KEY = process.env.BREVO_API_KEY;
let brevo;
if (BREVO_API_KEY) {
  brevo = new BrevoClient({ apiKey: BREVO_API_KEY });
  console.log("Brevo API Client successfully initialized.");
} else {
  console.warn("WARNING: BREVO_API_KEY env variable is missing!");
}

// Simple health-check endpoint
app.get('/', (req, res) => {
  res.send('BirrGo OTP Backend is live and running!');
});

// Helper function to generate a secure 6-digit OTP
function generateSecureOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to sanitize emails for Firebase paths (replacing '.' with '_')
function sanitizeEmail(email) {
  return email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_at_');
}

// 4. Secure Endpoint to generate, save, and send OTP
app.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  if (!brevo) {
    return res.status(500).json({ error: 'Mail dispatch services are temporarily unavailable.' });
  }

  const secureOtp = generateSecureOTP();

  try {
    // A) SAVE OTP TO FIREBASE SECURELY
    const sanitizedEmailKey = sanitizeEmail(email);
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes expiration

    // <-- FIXED: Replaced crashing admin.database() with modular getDatabase()
    const db = getDatabase();
    await db.ref(`otps/${sanitizedEmailKey}`).set({
      otp: secureOtp,
      expiresAt: expiresAt,
      verified: false
    });

    // B) SEND OTP EMAIL VIA BREVO
    const emailData = {
      subject: "Your OTP Verification Code",
      sender: { 
        name: process.env.BREVO_SENDER_NAME || "BirrGo Support", 
        email: process.env.BREVO_SENDER_EMAIL || "mail@birrgo.online" // Must be your authenticated Brevo domain
      },
      to: [{ email: email.toLowerCase() }],
      htmlContent: `
        <html>
          <body style="font-family: 'Inter', Arial, sans-serif; padding: 30px; background-color: #f9f9f9; color: #333;">
            <div style="max-width: 500px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 8px; border: 1px solid #eee;">
              <h2 style="color: #9A0019; margin-top: 0;">Confirm Your Email</h2>
              <p>Welcome to BirrGo! Use the 6-digit verification code below to complete your registration:</p>
              <div style="background: #f4f4f5; padding: 16px; text-align: center; border-radius: 6px; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #9A0019;">${secureOtp}</span>
              </div>
              <p style="font-size: 12px; color: #666;">This code is active for 5 minutes. If you did not sign up for an account, you can safely ignore this email.</p>
            </div>
          </body>
        </html>
      `
    };

    // If using custom Brevo Dashboard Templates
    if (process.env.BREVO_TEMPLATE_ID) {
      emailData.templateId = parseInt(process.env.BREVO_TEMPLATE_ID, 10);
      emailData.params = { otp: secureOtp };
      delete emailData.htmlContent;
      delete emailData.subject;
    }

    const response = await brevo.transactionalEmails.sendTransacEmail(emailData);
    console.log(`OTP Email successfully sent to ${email}. ID: ${response.messageId}`);
    
    return res.status(200).json({ success: true, message: 'OTP sent successfully.' });

  } catch (error) {
    console.error("Process Failure:", error);
    return res.status(500).json({ error: 'Internal server error processing registration verification.' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
