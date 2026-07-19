const express = require('express');
const cors = require('cors');
const { BrevoClient } = require('@getbrevo/brevo');
const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app'); 
const { getDatabase } = require('firebase-admin/database'); 

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Enable CORS securely for your frontend
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// 2. Initialize Firebase Admin securely using Render Environment Variables
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: cert(serviceAccount), 
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
  res.send('BirrGo Backend is live and running!');
});

// Helper function to generate a secure 6-digit OTP
function generateSecureOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to sanitize emails for Firebase paths (replacing '.' with '_')
function sanitizeEmail(email) {
  return email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_at_');
}

// ==========================================
// 4. OTP ENDPOINTS
// ==========================================

// Endpoint to generate, save, and send OTP
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
        email: process.env.BREVO_SENDER_EMAIL || "mail@birrgo.online" 
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

    await brevo.transactionalEmails.sendTransacEmail(emailData);

    return res.status(200).json({ success: true, message: 'OTP sent successfully' });

  } catch (error) {
    console.error("Error generating/sending OTP:", error);
    return res.status(500).json({ error: 'Failed to process OTP request.' });
  }
});

// Endpoint to verify the OTP
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

  try {
    const db = getDatabase();
    const sanitizedEmailKey = sanitizeEmail(email);
    const otpRef = db.ref(`otps/${sanitizedEmailKey}`);
    const snapshot = await otpRef.once('value');
    
    if (!snapshot.exists()) return res.status(400).json({ error: 'No OTP found for this email.' });

    const data = snapshot.val();
    
    if (Date.now() > data.expiresAt) {
      return res.status(400).json({ error: 'OTP has expired.' });
    }

    if (data.otp === otp) {
      await otpRef.update({ verified: true });
      return res.status(200).json({ success: true, message: 'OTP verified successfully.' });
    } else {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }
  } catch (error) {
    console.error("OTP Verification Error:", error);
    return res.status(500).json({ error: 'Server error during verification.' });
  }
});

// ==========================================
// 5. ONESIGNAL NOTIFICATION ENDPOINT 
// ==========================================

app.post('/send-push', async (req, res) => {
  // Log incoming request body to Render to confirm connection
  console.log("Received push notification request:", req.body); 

  const { title, message } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Notification title and message are required.' });
  }

  try {
    const db = getDatabase();
    
    // Fetch OneSignal App ID and REST API Key from Firebase Config Node 
    const configSnapshot = await db.ref('config/onesignal').once('value');
    const configData = configSnapshot.val();

    // Fallback to environment variables if Firebase node is empty
    const appId = (configData && configData.appId) ? configData.appId : process.env.ONESIGNAL_APP_ID;
    const restApiKey = (configData && configData.restApiKey) ? configData.restApiKey : process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restApiKey) {
      return res.status(500).json({ error: 'OneSignal credentials are not configured.' });
    }

    // Call the OneSignal REST API
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${restApiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        headings: { en: title },
        contents: { en: message },
        // UPDATED: Target both possible default segment names
        included_segments: ['Subscribed Users', 'Total Subscriptions'] 
      })
    });

    const responseData = await response.json();

    if (response.ok) {
      // Log the successful OneSignal dispatch ID
      console.log("OneSignal successfully accepted notification. ID:", responseData.id); 
      return res.status(200).json({ success: true, data: responseData });
    } else {
      console.error("OneSignal API Error:", responseData);
      return res.status(response.status).json({ error: 'Failed to dispatch via OneSignal', details: responseData });
    }

  } catch (error) {
    console.error("Broadcast Notification Error:", error);
    return res.status(500).json({ error: 'Server error while sending notification.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is listening on port ${PORT}`);
});
