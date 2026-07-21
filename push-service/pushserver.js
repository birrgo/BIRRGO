const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Enable CORS securely for birrgo.online and all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. Initialize Firebase Admin securely using Environment Variables
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

// Health check endpoint for Koyeb
app.get('/', (req, res) => {
  res.send('BirrGo Push Notification Service is live!');
});

// ==========================================
// ONESIGNAL PUSH NOTIFICATION ENDPOINT 
// ==========================================

app.post('/send-push', async (req, res) => {
  console.log("Push dispatch triggered:", req.body);

  const { title, message, segments, url, imageUrl } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Notification title and message are required.' });
  }

  try {
    const db = getDatabase();

    // Read credentials from Firebase or environment variables
    const configSnapshot = await db.ref('config/onesignal').once('value');
    const configData = configSnapshot.val();

    const appId = (configData && configData.appId) ? configData.appId : process.env.ONESIGNAL_APP_ID;
    const restApiKey = (configData && configData.restApiKey) ? configData.restApiKey : process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restApiKey) {
      console.error("Missing OneSignal Credentials");
      return res.status(500).json({ error: 'OneSignal credentials are missing on server.' });
    }

    // Target segments setup
    const targetSegments = (segments && Array.isArray(segments) && segments.length > 0)
      ? segments
      : ['All', 'Subscribed Users', 'Total Subscriptions'];

    // Construct notification payload
    const notificationPayload = {
      app_id: appId,
      target_channel: "push",
      headings: { en: title },
      contents: { en: message },
      included_segments: targetSegments,
      url: url || 'https://birrgo.online',
      ttl: 86400, // 24 Hours active window
      priority: 10
    };

    // Safely append big picture image parameters if provided
    if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '') {
      const cleanImg = imageUrl.trim();
      notificationPayload.big_picture = cleanImg;
      notificationPayload.chrome_web_image = cleanImg;
      notificationPayload.firefox_icon = cleanImg;
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${restApiKey}`
      },
      body: JSON.stringify(notificationPayload)
    });

    const responseData = await response.json();

    if (response.ok && responseData.id) {
      console.log("OneSignal push accepted successfully. ID:", responseData.id);

      // Async write to Firebase logs
      db.ref('logs/notifications').push({
        id: responseData.id,
        title: title,
        message: message,
        recipientsCount: responseData.recipients || 0,
        domain: 'birrgo.online',
        ttlSeconds: 86400,
        sentAt: Date.now()
      }).catch(err => console.error("Firebase log error:", err));

      return res.status(200).json({ success: true, active: true, ttl: "24 Hours", data: responseData });
    } else {
      console.error("OneSignal API rejected request:", responseData);
      return res.status(400).json({
        error: responseData.errors ? responseData.errors[0] : 'OneSignal push delivery failed.',
        details: responseData
      });
    }

  } catch (error) {
    console.error("Push Notification Delivery Error:", error);
    return res.status(500).json({ error: 'Internal server error processing push request.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Push Server running on port ${PORT}`);
});


