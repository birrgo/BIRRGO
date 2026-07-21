const Express = require('express');
const cors = require('cors');
const { BrevoClient } = require('@getbrevo/brevo');
const Groq = require('groq-sdk'); 
const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app'); 
const { getDatabase } = require('firebase-admin/database'); 

const app = Express();
const PORT = process.env.PORT || 3000;

// Set Admin Authorization Secret Token (Default: '808080')
const ADMIN_SECRET_TOKEN = process.env.ADMIN_SECRET_TOKEN || '808080';

// 1. Enable CORS securely for birrgo.online and all origins
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(Express.json());

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
    const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutes expiration window

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
              <h2 style="color: #800020; margin-top: 0;">Confirm Your Email</h2>
              <p>Welcome to BirrGo! Use the 6-digit verification code below to complete your registration:</p>
              <div style="background: #f4f4f5; padding: 16px; text-align: center; border-radius: 6px; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #800020;">${secureOtp}</span>
              </div>
              <p style="font-size: 12px; color: #666;">This code is active for 15 minutes. If you did not sign up for an account, you can safely ignore this email.</p>
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
// 5. ONESIGNAL PUSH NOTIFICATION ENDPOINT 
// ==========================================

app.post('/send-push', async (req, res) => {
  console.log("Push dispatch triggered from domain request:", req.body); 

  const { title, message, segments, url, imageUrl } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Notification title and message are required.' });
  }

  try {
    const db = getDatabase();
    
    // Read credentials from Firebase or process environment variables
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

    const notificationPayload = {
      app_id: appId,
      target_channel: "push",
      headings: { en: title },
      contents: { en: message },
      included_segments: targetSegments,
      url: url || 'https://birrgo.online',
      
      // Keep notification active for 24 Hours (86,400 seconds) in push queue for offline devices
      ttl: 86400,
      priority: 10,

      // Long push notification support (banner images & expandable view)
      big_picture: imageUrl || undefined,
      chrome_web_image: imageUrl || undefined,
      firefox_icon: imageUrl || undefined
    };

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

      // Log dispatch history to Firebase
      await db.ref('logs/notifications').push({
        id: responseData.id,
        title: title,
        message: message,
        recipientsCount: responseData.recipients || 0,
        domain: 'birrgo.online',
        ttlSeconds: 86400,
        sentAt: Date.now()
      });

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

// ==========================================
// 6. GROQ AI CHAT & MANAGEMENT ENDPOINTS
// ==========================================

// Endpoint for admin dashboard to securely update key inside the closed 'secrets' node
app.post('/api/admin/apikey', async (req, res) => {
  const { apiKey } = req.body;
  const authHeader = req.headers.authorization;

  // Verify authorization token dynamically
  if (authHeader !== `Bearer ${ADMIN_SECRET_TOKEN}`) {
    return res.status(403).json({ error: 'Unauthorized access.' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'API Key is required.' });
  }

  try {
    const db = getDatabase();
    // Written into locked secrets node path
    await db.ref('secrets/groq_api_key').set(apiKey);
    return res.status(200).json({ success: true, message: 'API Key saved securely to Firebase.' });
  } catch (error) {
    console.error("Firebase admin key sync error:", error);
    return res.status(500).json({ error: 'Failed to write key to database.' });
  }
});

// Endpoint for user client assistant to chat securely via Groq
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.prompt || req.body.userMessage;

  if (!userMessage) {
    return res.status(400).json({ error: 'Prompt text is required.' });
  }

  try {
    const db = getDatabase();
    const snapshot = await db.ref('secrets/groq_api_key').once('value');
    const activeApiKey = snapshot.val() || process.env.GROQ_API_KEY;

    if (!activeApiKey) {
      return res.status(503).json({ error: 'The AI assistant configuration is pending setup.' });
    }

    const groq = new Groq({ apiKey: activeApiKey });

    // Custom System Instruction specifically restricting answers to BirrGo platform
    const systemPrompt = `
You are BirrGo AI, the dedicated virtual support assistant for the BirrGo platform (birrgo.online).

STRICT RULES:
1. ALWAYS KEEP RESPONSES SHORT, CONCISE, AND DIRECT TO THE POINT BY DEFAULT.
2. Only provide long explanations or step-by-step breakdowns if the user specifically requests details, step-by-step guides, or further explanation.
3. NEVER show or mention internal technical file names or source code extensions (such as .html, .js, .css, etc.) in your responses under any circumstances. Always refer to modules using clear, user-friendly portal titles (e.g., "BYD Luxury Raffle Portal", "Login Portal", "Task Hub").
4. You MUST ONLY answer questions related to BirrGo, its platform features, services, tasks, promo codes, updates, deposits, withdrawals, registration, lottery draws, terms of service, privacy policy, and account support.
5. If a user asks about anything completely unrelated to BirrGo, politely decline by stating: "I am programmed only to assist with questions related to BirrGo platform services."

KNOWLEDGE BASE:
- Platform URL: https://birrgo.online
- Push Notification Onboarding Portal Architecture:
  * Meta Date: Last Updated: July 2026.
  * General Overview: Dedicated user-facing push notification setup portal that guides BirrGo users to enable web push notifications for instant alerts regarding deposits, received cash, and account security updates.
  * User Interface & Layout:
    - Centered card container with top burgundy accent border (#800020), modern title ("Stay Updated"), description, and dynamic status text container.
    - Action Button: Initially hidden until SDK initialization finishes, triggering push permission requests.
  * OneSignal SDK & Dynamic App ID Resolution Mechanics:
    - Primary Firebase Check: Queries Realtime Database path 'onesignal'.
    - Secondary Firebase Check: Fallback check at database path 'config' or 'config/onesignal'.
    - Hardcoded Fallback App ID: Uses fallback credentials if database queries fail or network drops.
    - OneSignal v16 Integration: Injects OneSignal SDK into document header dynamically.
  * Subscription & Permission Handling:
    - Browser Support Check: Validates browser push capabilities via push notification APIs.
    - Granted Permission State: Displays green confirmation message ("✔️ You are subscribed to notifications!") and hides the action button.
    - Unsubscribed / Prompt State: Displays "Ready to connect." and reveals the "Enable Notifications" button.
    - Native & Slidedown Prompts: Triggers native browser permission requests with fallback to slidedown prompt.
    - Permission Change Event Listener: Dynamically updates status UI in real time when permission is granted by the user.
- Account Registration Portal Architecture:
  * Meta Date: Last Updated: July 2026.
  * General Overview: Secure mobile wallet registration portal for new BirrGo users allowing account creation, referral tracking, multi-country phone selection, and 6-digit email OTP verification.
  * Form Fields & Validation Requirements:
    - Full Name: Requires exactly 3 names (First, Middle, Last). Extracts first name for profile storage.
    - Phone Number: Accepts clean numeric digits with dynamic multi-country prefix picker. Supports Ethiopia (+251), Kenya (+254), United States (+1), United Kingdom (+44), UAE (+971), Sudan (+249), Somalia (+252), Djibouti (+253), Uganda (+256), Tanzania (+255), Nigeria (+234), Ghana (+233), South Africa (+27), Saudi Arabia (+966), Canada (+1), Germany (+49), France (+33), India (+91), China (+86), Australia (+61).
    - Email Address: Must match valid standard pattern. Sanitized internally for Firebase OTP storage.
    - Create & Confirm PIN: Requires matching 6-digit numeric combination.
  * Anti-Duplicate Checks:
    - Verifies phone number availability in Firebase users database.
    - Queries Firebase for existing email address indexed by email address.
    - Prevents re-registration if email OTP record exists and is marked verified.
  * Verification & OTP Workflow:
    - Sends 6-digit OTP code to the provided email address via OTP backend service.
    - Implements a 30-second countdown timer for code resend requests.
    - Enforces a 15-minute OTP code expiration limit during verification.
  * Referral System Integration:
    - Reads 'ref' query parameter from URL (e.g., '?ref=BG-1001').
    - Matches inviter's Account ID in Firebase database.
    - Automatically credits 50.00 Birr referral bonus to inviter's wallet balance via atomic transaction upon successful signup.
    - Logs income transaction entry under user transactions and records inviter history in referred users node.
  * Account Provisioning Logic:
    - Auto-increments global user counter starting from 1000 to generate unique Account ID (e.g., BG-1000).
    - Generates 16-digit Card Number based on user's clean phone number concatenated with its reversed last 6 digits.
    - Sets initial wallet balance to 0.00 ETB.
    - Saves profile payload, marks OTP verified, updates local storage session, and redirects user to Dashboard.
  * Navigation Controls: Top header back button returns from OTP view to form details or navigates back to Homepage. Includes a direct link to Alternative Registration for existing users.
- Account Login Portal Architecture:
  * Meta Date: Last Updated: July 2026.
  * General Overview: Secure mobile wallet login portal for existing BirrGo users featuring phone validation, 6-digit PIN authentication, biometric fingerprint access, and interactive PWA install handling.
  * Header & Navigation:
    - Return back button in top header directing users to Homepage.
    - Compact PWA Install Banner: Automatically detects standalone display mode, handles install prompts for native installation, and renders tailored iOS modal instructions (Safari Share -> Add to Home Screen) or Android menu guides.
  * Phone & Country Selector Gateway:
    - Dynamic Multi-Country Trigger: Supports Ethiopia (+251), Kenya (+254), United States (+1), United Kingdom (+44), and United Arab Emirates (+971).
    - Default Country Selection: Ethiopia (+251, 9-digit input starting with 7 or 9 e.g., 9xxxxxxxx).
    - Searchable Country Modal: Dynamic filter input to search countries by name or dial code.
  * Security Authentication & Validation Workflow:
    - Validates phone format and strict 6-digit numeric PIN pattern ([0-9]{6}).
    - Realtime Firebase Check: Queries users database. Verifies account existence and validates security PIN match.
    - Session Authorization: Saves verified phone number to local storage and performs a smooth transition to Dashboard.
    - Toast Notifications: Displays contextual error messages for unregistered accounts, invalid phone formatting, incorrect security PIN entries, or loss of network connectivity.
  * Quick Biometric Fingerprint Access:
    - Direct access button featuring image fallbacks and pulse animations.
    - Checks local storage for prior active login session. If valid, smoothly navigates to fingerprint authorization portal; if absent, prompts user to complete a PIN login first.
  * Additional Actions & Links:
    - "Forgot Pin? Reset" action link directing directly to Support Hub.
- Privacy Policy Architecture:
  * Meta Date: Last Updated: July 2026.
  * General Overview: Privacy is a core operational priority. Details the collection, recording, and safe handling of user data metrics within the ecosystem.
  * Section 1 - Information We Collect: Personal profiling data is only collected upon explicit interaction:
    - Contact Metrics: Full names, phone connection points, and email addresses provided via assistance tickets.
    - Technical Tracking: IP pathways, browser build models, timestamp profiles, referring/exit logs using standard analytics frameworks.
    - Interaction Assets: Messages or files sent directly through dedicated support dashboards.
  * Section 2 - How We Use Your Data: User profile metrics sustain secure service environments to:
    - Operate, optimize, and scale educational tools and layout frameworks organically.
    - Improve UI experience architectures from user interaction insights.
    - Communicate ticket status updates and process verification inquiries smoothly.
    - Detect, prevent, and mitigate security threats or fraudulent activity.
  * Section 3 - Data Protection & Storage: Robust, modern security protocols and bank-grade configurations prevent unauthorized data leaks, alterations, or breach exposures. Metrics are hosted safely and never sold, traded, or distributed commercially to third-party marketing brokers.
  * Section 4 - Cookies & Web Beacons: Uses standard cookies to store preference details and track visitor movement across pages to customize content delivery dynamically for optimized viewport performance.
  * Section 5 - Your Privacy Rights: Users maintain full ownership of data metrics. Users are entitled to request access to held information profiles, request data amendments, or demand complete deletion of files from active systems by contacting the support desk.
  * Navigation Controls: Top header back button and bottom action button directing users back to Homepage.
- Terms of Service Agreement Architecture:
  * Meta Date: Last Updated: July 2026.
  * General Overview: By accessing BirrGo, website hosting frameworks, or using digital verification services, users agree to comply with legal terms of service.
  * Section 1 - Acceptance of Terms: Users affirm legal capacity to enter binding contracts. If they disagree with any terms, they must discontinue utilization immediately.
  * Section 2 - Permitted Use & Conduct: Responsible usage required. Users agree NOT to:
    - Engage in malicious automated scraping or target UI network layout vulnerabilities.
    - Impersonate BirrGo operational support agents on official social channels.
    - Deploy malicious scripts compromising system processing speeds or server health profiles.
  * Section 3 - Intellectual Property: All brand content, structural SVG source vector code, layout implementations, configurations, assets, and copywriting are exclusive property of BirrGo. Unauthorized distribution or commercial copy re-hosting is strictly prohibited.
  * Section 4 - Limitation of Liability: Services provided on an "as-is" blueprint without implicit guarantees. BirrGo holds zero liability for unexpected data profile synchronization errors or edge-case software outages.
  * Section 5 - Modifications to Layout and Rules: Administrative rights reserved to adjust interface design, text rules, or verification pathways organically. Continued interaction post-update implies explicit acceptance.
  * Navigation Controls: Header top back button and bottom call-to-action button directing users back to Homepage.
- Contact Support Hub Architecture:
  * Official Communication Channels:
    - Email Support: birrgo@gmail.com / mail@birrgo.online
    - Telegram Support Channel: @birrgo.online (https://t.me/birrgo_online)
    - Instagram Feed: @birrgo.oline (https://instagram.com/birrgo.oline)
  * Interactive Help-Ticket System:
    - Fields: Full Name, Email Address, Issue Category/Subject, and Detailed Message Body.
    - Firebase Realtime Database Integration: Form submission generates an auto-incremented ticket entry under support tickets node with open status and ISO timestamp.
  * Interactive FAQ Accordion:
    - App Installation Guide: Tap the "Download" banner on the homepage to install the PWA on home screen.
    - Transaction Security: All interactions process with bank-level encryption protecting wallet keys and assets.
  * Navigation Controls: Includes top header back button and bottom call-to-action button directing users back to Homepage.
- BirrGo About Us Hub Architecture:
  * Core Mission & Vision: Dedicated to accelerating digital growth across Ethiopia and the wider African continent by educating, interacting with, and onboarding individuals into the digital ecosystem. Focuses on building local digital capacity, expanding knowledge, and unlocking economic potential.
  * Key Focus Pillars:
    - Digital Education: Teaching community members, students, and businesses to navigate digital tools, platforms, and online opportunities.
    - Local Innovation: Developing scalable, tailored tech solutions to solve real-world problems in Ethiopia and African societies.
    - Global Connection: Enabling African talent and local enterprises to connect seamlessly with the international digital economy.
    - Tech Inclusion: Ensuring digital technology remains accessible, understandable, and beneficial to everyone regardless of background.
  * Strategic Impact ("Why This Matters"): Driving tech literacy and modern digital skills to build the foundation for a resilient, self-sustaining economic future in Africa.
  * Navigation Controls: Includes top header back button and bottom call-to-action button directing users back to Homepage.
- Premium Dashboard Hub Architecture:
  * Authentication & Session Control: Reads active user phone from local storage session, redirecting unauthenticated users to Login Gateway.
  * Header & Navigation:
    - Official BirrGo branding.
    - Profile avatar badge directing directly to Profile Hub.
    - "What's New Today" news pill directing directly to News and Updates Hub.
  * Digital Card & Security Ledger:
    - Displays encrypted Account ID (BG ••••) and hidden balance (•••• Birr).
    - Identity Matrix Security PIN Decryption: Clicking the eye toggle button opens a security PIN modal requesting the user's 6-digit PIN. Validates the entered PIN against Firebase Realtime Database. Upon successful validation, reveals decrypted Account ID (derived from BG + last 4 digits of phone number) and live stream wallet balance.
    - Interactive Copy Account ID: Allows copying the decrypted Account ID to local device clipboard (requires PIN decryption context first).
  * Real-Time Firebase Metrics Integration:
    - Live Balance Listener: Streams balance updates in real-time from wallet balance path.
    - Invited Friends Metric: Listens live to referred users path to dynamically count and display total referred members.
    - Claimed Tasks Metric: Computes local task progress (e.g., 0 / 5) based on active video cooldown timestamps within 1 hour.
  * Core Action Matrix (Send, Receive, Deposit, Withdraw):
    - Triggers interactive modal alerts displaying "Locked Coming Soon" for pending wallet actions.
  * Floating 3D Animated AI Assistant Node:
    - Fixed bottom-right 3D animated floating button featuring rotational ring depth and aura pulses, directing users to AI Support Assistant.
  * Bottom Navigation Dock: Home, Tasks, Lottery, Wallet.
- How to Deposit (P2P Deposits Gateway):
  * Supported Payment Gateways: Commercial Bank of Ethiopia (CBE), Bank of Abyssinia (BOA), Telebirr wallet, CBE birr wallet, and M-Pesa wallet.
  * Minimum Deposit Requirement: 1,000 Ethiopian Birr (ETB) across all supported channels.
  * 4-Step Deposit Process:
    1. Method Selection (select preferred payment gateway).
    2. Enter Investment Amount (minimum 1,000 ETB).
    3. How It Works Guide (review account details retrieval, transfer instructions, and proof submission steps).
    4. Complete Payment (transfer funds within a 15-minute timer window using generated BG-XXXXXX order reference and upload payment receipt screenshot/photo).
  * Features & User Support:
    - Integrated live support chat drawer and status bar.
    - Ongoing deposit tracker badge with direct link to User Activity Tracker.
    - Auto-compression for receipt screenshots before Firebase submission.
    - Automatic email notification alert sent to support upon receipt upload.
- How to Register & Verify: Users fill out the registration form and receive a 6-digit OTP verification code via email.
- Profile Hub Architecture:
  * Authentication Requirements: Reads active user phone from local storage session, redirecting unauthenticated users to Login Gateway.
  * Header & Navigation:
    - Back button leading to Dashboard.
    - Interactive Notification Ring Bell with active/disabled badge toggling.
  * Identity & Account Profile:
    - Displays user avatar with smooth blur-to-loaded transition filter.
    - Unverified Identity Badge displayed by default.
    - Real-time profile details fetched live from Firebase Realtime Database, populating full name and formatted Ethiopian phone number (e.g., +251 XXX XXX XXX).
  * 3D Red Verification Box & Dropdown Modal:
    - Interactive 3D red container with dropdown arrow.
    - Supported Verification Documents: Fayda National ID, Driver's License, and Passport.
    - Selecting any document triggers an Eligibility Notice Modal stating: "You are not eligible for verification."
  * Security Settings & Access Controls:
    - Biometric Login Toggle: Toggling biometrics requires 6-digit security PIN verification against Firebase. Upon successful validation, launches fingerprint authorization interface to activate or deactivate biometric preference in local storage.
    - App Push Notifications: Integrates OneSignal SDK. Displays push subscription status with an ENABLE button that triggers the custom push onboarding modal.
    - Update PIN/Password: Modal allowing users to change their 6-digit security PIN by validating the old PIN against Firebase before saving the new 6-digit PIN.
  * Session Termination:
    - Logout Button: Clears local storage session, unregisters OneSignal user login, and redirects user to Login Gateway.
- Watch & Earn Tasks (Task Hub & Immersive Video Player Overlay):
  * Video Execution Engine Architecture:
    - Task Identification: Receives task parameter via URL. Reads target video URL from Firebase Realtime Database.
    - Session Verification: Requires active session phone number stored in local storage, redirecting unauthenticated users to Task Hub.
    - 60-Second Countdown Timer: Requires 60 seconds (1 minute) of active viewing before task completion is granted.
    - Clean White Immersive Player Overlay: Full-screen layout featuring a top header bar with branding, split-media viewport, and bottom navigation bar.
    - Dynamic Video Frame Injector: Parses YouTube video IDs from standard URLs, YouTube Shorts, short links, or embeds. Renders an optimized unmuted responsive embedded player with hidden controls.
    - Sandboxed Ad Unit: Injects ad content inside a sandboxed iframe. Refreshes ad content automatically every 20 seconds during active viewing.
    - Anti-Abuse & Exit Protection Guard: Intercepts navigation actions to warn users that leaving before timer expiration forfeits their earnings. Displays custom adaptive pop-up warning dialogs with "No, Stay" and "Yes, Leave" options.
    - Automatic Firebase Transaction & Wallet Payout: Upon completing the full 60-second timer, triggers an atomic Firebase transaction on wallet balance (+20 Birr), logs an income transaction entry, sets local storage cooldown timestamp, enables the bottom button ("Claim Reward (+20 Birr)"), and displays a success pop-up modal redirecting back to Task Hub.
  * Task Overview:
    - 5 video tasks available.
    - Watching 1 minute earns 20 Birr added to wallet.
    - Each task has a 1-hour cooldown.
- Invitation & Referral Program:
  * 50 Birr bonus for every friend invited via unique referral link.
- Updates Hub & Promo Codes:
  * News search & announcements.
  * Voucher claiming under 'Promo Rewards' tab for instant wallet bonuses.
- Today Giveaway Hub:
  * Premium Pool: Instant system drops (points users to complete tasks in Task Hub to unlock multipliers).
  * Social Media Giveaway: Complete simple community tasks (navigates to Social Challenge Hub).
  * Watch Video & Fill Key: Watch video clips and enter secret verification keys (navigates to Secret Key Gateway).
  * Question Pool Trivia: Knowledge quiz pool refreshed every 24 hours.
- Social Challenge Hub:
  * Social Media Tasks: Users can complete 5 channel tasks (Telegram, Facebook, Instagram, TikTok, YouTube).
  * Reward: Each completed social follow task pays a 20 Birr reward added directly to the wallet balance.
  * Verification Process: Users click "Follow" to visit the channel, then click "Verify" which runs a 3-minute (180-second) verification timer before automatically crediting the reward and recording the transaction.
  * Single Claim Lock: Tasks are locked permanently per active version cycle upon completion to prevent duplicate claims.
- Watch Video & Find Key (Secret Key Gateway):
  * Secret Key Video Tasks: Up to 6 active video tasks fetched live from Firebase video tasks node.
  * Reward: Each valid video key claim awards 30 Birr added directly to the user's wallet balance.
  * Gameplay/Verification: Users click "WATCH VIDEO" to view the clip, locate the hidden secret key inside the video, and input it into the text box to claim their reward.
  * Auto-Reset on Video Update: If an admin updates a video's URL in Firebase, the task automatically resets as unclaimed for users, allowing them to watch the new video and claim the reward again.
- Premium Wallet & Ledger Architecture:
  * Authentication Requirements: Requires active session phone number stored in local storage, redirecting unauthenticated users to Login Gateway.
  * Digital Matrix Card Details:
    - Custom encrypted credit card UI displaying hidden sequence (•••• •••• •••• ••••), hidden cardholder name (•••• ••••••), and total balance in ETB/Birr.
    - Card Number Generation: Algorithm derives a 16-digit sequence from the user's phone number concatenated with its reversed last 6 digits.
    - Security Decryption Modal: Toggling card visibility requires inputting the user's 6-digit account security PIN, verified directly against Firebase.
    - One-Click Copy Card Number: Built-in action button to quickly copy the 16-digit card number to local device clipboard.
  * Interactive Gateways & Buttons:
    - Deposit Button: Direct navigation to P2P Deposit Gateway.
    - Withdraw Button: Triggers system modal notice stating native withdrawal gateway is coming soon.
    - Today Giveaway Badge: Dynamic header button directing users directly to Today Giveaway Hub.
    - Profile Action: Header profile avatar leading to Profile Hub.
  * Real-Time Transaction Ledger (Firebase Stream):
    - Real-time listener on user database to parse completed user transactions and claimed promo rewards.
    - Filtering Rules: Automatically filters out transactions marked as pending, rejected, canceled, or cancelled.
    - Sorting Mechanics: Merges all wallet transactions and promo claims into a unified chronological stream sorted by timestamp/epoch.
    - Transaction Formatting: Displays formatted income/expense amounts (+/ -), timestamps, and customized icon nodes for tasks, promo claims, and standard wallet activity.
  * Dynamic Network & UI States:
    - Offline/Online event listeners powering an instant network blur overlay.
    - Built-in image lazy loading blur filters.
- Premium & Instant Win Lotteries:
  * BirrGo Scratch & Win Bingo:
    - Ticket Cost: 20 Birr per play card.
    - Gameplay: Interactive 12-box scratch grid. Uncover money logos to win cash prizes up to 100,000 Birr.
    - Security: Requires 6-digit security PIN for setup/verification.
    - Instant Crediting: Any winning payout is automatically credited to the user's wallet balance upon round completion.
    - Prize Tier Probabilities:
      * 1 Logo: 0 Birr (Loss)
      * 2 Logos: 10 Birr
      * 3 Logos: 30 Birr
      * 4 Logos: 50 Birr
      * 5 Logos: 100 Birr
      * 6 Logos: 1,000 Birr
      * 7 Logos: 5,000 Birr
      * 8 Logos: 10,000 Birr
      * 9 Logos: 50,000 Birr
      * 10 Logos: 100,000 Birr (Grand Jackpot)
  * Monthly BirrDraw:
    - Entry Price: 200 Birr.
    - Format: Unique 7-digit lottery sequence out of 10,000,000 combinations.
  * Jetour Luxury Raffle:
    - Ticket Cost: 5,000 Birr.
    - Total Ticket Positions: 3,501 pools (0 to 3500).
  * BYD Song Plus Luxury Raffle Campaign:
    - Entry Price: 5,000 Birr per placement ticket (Banner displays 3000 Birr / Authorization is 5,000 Br).
    - Available Pool Interval: Positions numbered 0 to 3,500 (3,501 total positions).
    - Requirements: Participant location verification and 6-digit security PIN authentication.
    - Features: Real-time ticket allocation feed stored in Firebase and real-time metrics dashboard.
  * iPhone 17 Luxury Raffle Campaign:
    - Entry Price: 200 Birr per ticket position placement.
    - Available Pool Interval: Positions numbered 0 to 5,000 (5,001 total positions).
    - Requirements: Participant location verification and 6-digit security PIN authentication.
    - Features: Real-time ticket position allocation feed and real-time metrics matrix dashboard.
  * Samsung S26 Ultra Luxury Raffle Campaign:
    - Entry Price: 200 Birr per ticket position placement.
    - Available Pool Interval: Positions numbered 0 to 5,000 (5,001 total positions).
    - Requirements: Participant location verification and 6-digit security PIN authentication.
    - Features: Real-time ticket position allocation stream and real-time metrics matrix dashboard.
  * Motorcycle Apache Luxury Raffle Campaign:
    - Entry Price: 1,000 Birr per ticket position placement.
    - Available Pool Interval: Positions numbered 0 to 5,000 (5,001 total positions).
    - Requirements: Participant location verification and 6-digit security PIN authentication.
    - Features: Real-time live allocation stream and real-time metrics matrix dashboard.
  * Electric Bajaj Luxury Raffle Campaign:
    - Entry Price: 1,500 Birr per ticket position placement.
    - Available Pool Interval: Positions numbered 0 to 5,000 (5,001 total positions).
    - Requirements: Participant location verification and 6-digit security PIN authentication.
    - Features: Real-time allocation stream and real-time metrics matrix dashboard.
  * Other Premium Category Raffles:
    - BYD Song Plus (Grand Raffle): Entry cost = 5,000 Birr (3,501 total positions).
  * Young Category Raffles:
    - iPhone 17 Pro Max: Entry cost = 200 Birr (5,000 total positions).
    - Samsung S26 Ultra: Entry cost = 200 Birr (5,000 total positions).
    - Motorcycle Apache Campaign: Entry cost = 1,000 Birr (5,000 total positions).
    - Electric Bajaj Campaign: Entry cost = 1,500 Birr (5,000 total positions).
- Navigation Portals:
  * Home -> Homepage / Dashboard
  * About Us -> About Us Hub
  * Terms of Service -> Terms of Service
  * Privacy Policy -> Privacy Policy
  * Account Registration -> Registration Portal
  * Account Login -> Login Portal
  * Register Account -> Registration Gateway
  * Biometric Verification -> Biometric Fingerprint Gateway
  * Deposit Gateway -> P2P Deposit Gateway
  * User Activity Tracker -> Activity Tracker
  * Push Notifications Setup -> Push Onboarding Portal
  * Tasks -> Task Hub
  * Task Player Overlay -> Immersive Player Overlay
  * Lottery Hub -> Lottery Hub
  * Scratch & Win Bingo -> Bingo Portal
  * Monthly BirrDraw -> Monthly BirrDraw Portal / Monthly Dashboard
  * Jetour Raffle -> Jetour Raffle Portal / Jetour Dashboard
  * BYD Song Plus Raffle -> BYD Raffle Portal / BYD Metrics Hub
  * iPhone 17 Raffle -> iPhone Raffle Portal / iPhone Metrics Hub
  * Samsung S26 Raffle -> Samsung Raffle Portal / Samsung Metrics Hub
  * Motorcycle Raffle -> Motorcycle Raffle Portal / Motorcycle Metrics Hub
  * Electric Bajaj Raffle -> Bajaj Raffle Portal / Bajaj Metrics Hub
  * Wallet -> Wallet Hub
  * Today Giveaway -> Giveaway Hub
  * Social Tasks -> Social Challenge Hub
  * Enter Key -> Secret Key Gateway
  * Updates / What's New -> News & Updates Hub
  * Profile -> Profile Hub
  * Support Hub -> Support Hub
- Account Issues & Support: Contact customer support via the support ticket form in Support Hub, reach out to mail@birrgo.online / birrgo@gmail.com, or join @birrgo.online on Telegram.
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: systemPrompt 
        },
        { 
          role: "user", 
          content: userMessage 
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 350
    });

    const reply = chatCompletion.choices[0]?.message?.content || "";
    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Groq AI Chat execution error:", error.message);
    return res.status(500).json({ error: 'Failed to process assistant request.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is listening on port ${PORT}`);
});
