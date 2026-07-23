const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    let serviceAccount;
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (typeof rawServiceAccount === 'string') {
      serviceAccount = JSON.parse(
        rawServiceAccount.startsWith('{') 
          ? rawServiceAccount 
          : Buffer.from(rawServiceAccount, 'base64').toString('utf8')
      );
    } else {
      serviceAccount = rawServiceAccount;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: cert(serviceAccount), 
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
    }
    console.log("Push Service: Firebase Admin Connected!");
  } catch (error) {
    console.error("Push Service: Firebase init error:", error);
  }
}

// Health Check Endpoint
app.get('/', (req, res) => {
  res.send('BirrGo Push Notification Microservice is Running!');
});

// Broadcast Endpoint
app.post('/api/send-push', async (req, res) => {
  const { title, message, imageUrl, iconUrl, badgeUrl, badge, url, segments } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message body are required.' });
  }

  try {
    const db = getDatabase();
    
    // Fetch live OneSignal credentials and default icon configs from Firebase
    const configSnapshot = await db.ref('config/onesignal').once('value');
    const configData = configSnapshot.val() || {};

    const appId = configData.appId || process.env.ONESIGNAL_APP_ID;
    const restApiKey = configData.restApiKey || process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restApiKey) {
      return res.status(500).json({ error: 'OneSignal API credentials not configured in Firebase.' });
    }

    // Determine final icons with explicit fallback to birrgo.online defaults
    const defaultIconFallback = 'https://birrgo.online/icon.png';
    const defaultBadgeFallback = 'https://birrgo.online/badge-icon.png';

    const finalIcon = imageUrl || iconUrl || configData.defaultIcon || process.env.ONESIGNAL_DEFAULT_ICON || defaultIconFallback;
    const finalBadge = badgeUrl || badge || configData.defaultBadge || process.env.ONESIGNAL_DEFAULT_BADGE || defaultBadgeFallback;

    const payload = {
      app_id: appId,
      target_channel: "push",
      headings: { en: title },
      contents: { en: message },
      included_segments: (segments && segments.length) ? segments : ['All', 'Subscribed Users', 'Total Subscriptions'],
      url: url || 'https://birrgo.online',
      ttl: 86400,
      priority: 10,
      
      // Large preview image inside notification panel
      big_picture: imageUrl || undefined,
      
      // Main app logo icon inside notification drawer
      chrome_web_icon: finalIcon,
      firefox_icon: finalIcon,
      
      // Android status bar small icon (Monochrome white PNG)
      chrome_web_badge: finalBadge,
      small_icon: finalBadge,
      chrome_stat_icon: finalBadge
    };

    // Prepare auth header formatted for OneSignal REST API
    const authHeader = restApiKey.startsWith('Key ') || restApiKey.startsWith('Basic ')
      ? restApiKey 
      : `Basic ${restApiKey}`;

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json();

    if (response.ok && responseData.id) {
      // Log broadcast event to Firebase Realtime Database
      await db.ref('logs/notifications').push({
        id: responseData.id,
        title: title,
        message: message,
        recipientsCount: responseData.recipients || 0,
        sentAt: Date.now()
      });

      return res.status(200).json({ success: true, id: responseData.id });
    } else {
      const errorMsg = responseData.errors ? responseData.errors[0] : 'OneSignal delivery failed.';
      return res.status(400).json({ error: errorMsg, details: responseData });
    }
  } catch (error) {
    console.error("Push Broadcast Error:", error);
    return res.status(500).json({ error: 'Server error processing push request.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Push microservice active on port ${PORT}`);
});
