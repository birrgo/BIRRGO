const admin = require('firebase-admin');

// Initialize Firebase Admin safely (Singleton pattern for Vercel execution environment)
if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    const serviceAccount = typeof rawAccount === 'string' ? JSON.parse(rawAccount) : rawAccount;
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log("Firebase Admin initialized successfully.");
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
  }
}

module.exports = async (req, res) => {
  // Always return application/json
  res.setHeader('Content-Type', 'application/json');

  // 1. Configure CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const body = req.body || {};
    const { title, message, segments, url, imageUrl, badgeUrl, badge } = body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Notification title and message are required.' });
    }

    // Default hardcoded fallbacks
    const fallbackIcon = 'https://birrgo.online/icon.png';
    const fallbackBadge = 'https://birrgo.online/badge-icon.png';

    // Check environment variables first
    let appId = process.env.ONESIGNAL_APP_ID;
    let restApiKey = process.env.ONESIGNAL_REST_KEY || process.env.ONESIGNAL_REST_API_KEY;
    let defaultBadge = process.env.ONESIGNAL_DEFAULT_BADGE || fallbackBadge;
    let defaultIcon = process.env.ONESIGNAL_DEFAULT_ICON || fallbackIcon;

    // Fetch dynamic config from Firebase Realtime DB if available
    if (admin.apps.length) {
      try {
        const db = admin.database();
        const configSnapshot = await db.ref('config/onesignal').once('value');
        const configData = configSnapshot.val();

        if (configData) {
          if (configData.appId && !appId) appId = configData.appId;
          if (configData.restApiKey && !restApiKey) restApiKey = configData.restApiKey;
          if (configData.defaultBadge) defaultBadge = configData.defaultBadge;
          if (configData.defaultIcon) defaultIcon = configData.defaultIcon;
        }
      } catch (dbErr) {
        console.error("Failed to read OneSignal config from Firebase:", dbErr.message);
      }
    }

    if (!appId || !restApiKey) {
      console.error("Missing OneSignal Credentials");
      return res.status(500).json({ 
        success: false, 
        error: 'OneSignal credentials (APP ID or REST KEY) are missing on server.' 
      });
    }

    // Target segments setup
    const targetSegments = (Array.isArray(segments) && segments.length > 0)
      ? segments
      : ['Subscribed Users', 'Total Subscriptions', 'All'];

    // Construct OneSignal Payload
    const notificationPayload = {
      app_id: appId,
      target_channel: "push",
      headings: { en: title },
      contents: { en: message },
      included_segments: targetSegments,
      url: url || 'https://birrgo.online',
      ttl: 86400,
      priority: 10
    };

    // Attach status bar badge icon (Monochrome White PNG)
    const activeBadge = badgeUrl || badge || defaultBadge;
    if (activeBadge && typeof activeBadge === 'string' && activeBadge.trim() !== '') {
      const cleanBadge = activeBadge.trim();
      
      // Web PWA / Chrome / Firefox status bar badge
      notificationPayload.chrome_web_badge = cleanBadge;
      notificationPayload.chrome_stat_icon = cleanBadge;

      // Android Native / Cordova Status Bar Icon reference (defined in config.xml)
      notificationPayload.small_icon = 'ic_stat_onesignal_default'; 
      notificationPayload.android_accent_color = 'FF800000'; // Burgundy accent color
    }

    // Attach large panel icon / images
    const activeImage = (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '') 
      ? imageUrl.trim() 
      : defaultIcon;

    if (activeImage) {
      notificationPayload.big_picture = activeImage;
      notificationPayload.chrome_web_image = activeImage;
      notificationPayload.chrome_web_icon = activeImage;
      notificationPayload.firefox_icon = activeImage;
      notificationPayload.large_icon = activeImage; // Drawer icon for Android
    }

    // Universal OneSignal Auth Header (Handles legacy keys & v2 os_v2_app keys)
    let authHeader = restApiKey;
    if (!restApiKey.startsWith('Basic ') && !restApiKey.startsWith('Key ')) {
      authHeader = restApiKey.startsWith('os_v2_') ? `Key ${restApiKey}` : `Basic ${restApiKey}`;
    }

    // Call OneSignal API
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': authHeader
      },
      body: JSON.stringify(notificationPayload)
    });

    const responseData = await response.json();

    if (response.ok && responseData.id) {
      console.log("Push delivered via OneSignal ID:", responseData.id);

      // Async write log to Firebase Realtime Database
      if (admin.apps.length) {
        admin.database().ref('logs/notifications').push({
          id: responseData.id,
          title: title,
          message: message,
          recipientsCount: responseData.recipients || 0,
          domain: 'birrgo.online',
          sentAt: Date.now()
        }).catch(err => console.error("Firebase log error:", err.message));
      }

      return res.status(200).json({ 
        success: true, 
        recipients: responseData.recipients || 0,
        notificationId: responseData.id 
      });
    } else {
      console.error("OneSignal API rejected request:", responseData);
      const errDetail = responseData.errors 
        ? (Array.isArray(responseData.errors) ? responseData.errors[0] : JSON.stringify(responseData.errors)) 
        : 'OneSignal delivery rejected.';

      return res.status(400).json({
        success: false,
        error: errDetail
      });
    }

  } catch (error) {
    console.error("Serverless Function Error:", error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error processing push request.' });
  }
};
