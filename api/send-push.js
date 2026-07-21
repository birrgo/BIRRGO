const admin = require('firebase-admin');

// Initialize Firebase Admin once globally
if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log("Firebase Admin initialized on Vercel.");
  } catch (err) {
    console.error("Firebase Admin initialization failed:", err);
  }
}

module.exports = async (req, res) => {
  // 1. Enable CORS for birrgo.online and all origins
  res.setHeader('Access-Control-Allow-Credentials', true);
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
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  console.log("Push dispatch triggered from request body:", req.body);

  const { title, message, segments, url, imageUrl } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Notification title and message are required.' });
  }

  try {
    let appId = process.env.ONESIGNAL_APP_ID;
    let restApiKey = process.env.ONESIGNAL_REST_API_KEY;

    // Optional: Fetch credentials dynamically from Firebase Realtime Database
    if (admin.apps.length) {
      const db = admin.database();
      const configSnapshot = await db.ref('config/onesignal').once('value');
      const configData = configSnapshot.val();

      if (configData && configData.appId) appId = configData.appId;
      if (configData && configData.restApiKey) restApiKey = configData.restApiKey;
    }

    if (!appId || !restApiKey) {
      console.error("Missing OneSignal Credentials");
      return res.status(500).json({ error: 'OneSignal credentials are missing on server.' });
    }

    // Target segments configuration
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

    // Append image properties safely if valid URL exists
    if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '') {
      const cleanImg = imageUrl.trim();
      notificationPayload.big_picture = cleanImg;
      notificationPayload.chrome_web_image = cleanImg;
      notificationPayload.firefox_icon = cleanImg;
    }

    // Dispatch request to OneSignal API
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

      // Log dispatch history to Firebase asynchronously
      if (admin.apps.length) {
        admin.database().ref('logs/notifications').push({
          id: responseData.id,
          title: title,
          message: message,
          recipientsCount: responseData.recipients || 0,
          domain: 'birrgo.online',
          ttlSeconds: 86400,
          sentAt: Date.now()
        }).catch(err => console.error("Firebase log error:", err));
      }

      return res.status(200).json({ success: true, active: true, ttl: "24 Hours", data: responseData });
    } else {
      console.error("OneSignal API rejected request:", responseData);
      return res.status(400).json({
        error: responseData.errors ? responseData.errors[0] : 'OneSignal push delivery failed.',
        details: responseData
      });
    }

  } catch (error) {
    console.error("Push Delivery Error:", error);
    return res.status(500).json({ error: 'Internal server error processing push request.' });
  }
};
