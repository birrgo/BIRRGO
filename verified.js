if (sessionStorage.getItem('birrgo_admin_session') !== 'active') {
    console.warn("Session warning: Admin credentials bypass mode active.");
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCRHoIZf1ZPR9m3YYTv-I9CfwyGqsSOMWo",
    authDomain: "birrgo-fdf7e.firebaseapp.com",
    databaseURL: "https://birrgo-fdf7e-default-rtdb.firebaseio.com",
    projectId: "birrgo-fdf7e",
    storageBucket: "birrgo-fdf7e.firebasestorage.app",
    messagingSenderId: "2317445154",
    appId: "1:2317445154:web:4275cbb0f46b28f64f827b",
    measurementId: "G-24X13TZ43D"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const statusDiv = document.getElementById('statusMessage');

let storedApiKey = "";

function sanitizeEmail(email) {
    return email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_at_');
}

function desanitizeEmailKey(key) {
    return key.replace(/_at_/g, '@').replace(/_/g, '.');
}

// 1. Live Fetch & Table Render
function initializeLiveLogs() {
    const otpsRef = ref(db, 'otps');
    
    onValue(otpsRef, (snapshot) => {
        const tbody = document.getElementById('logsTableBody');
        if (!tbody) return; // Guard clause to prevent errors if the elements haven't loaded yet
        
        tbody.innerHTML = "";

        if (!snapshot.exists()) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-8 text-center text-slate-500">No verification requests found. Ready to process accounts.</td>
                </tr>`;
            return;
        }

        const data = snapshot.val();
        
        Object.keys(data).forEach((key) => {
            const record = data[key];
            if (!record) return;
            
            const currentTime = Date.now();
            const isExpired = currentTime > record.expiresAt;
            
            let statusBadge = "";
            if (record.verified) {
                statusBadge = `<span class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-bold">Verified</span>`;
            } else if (isExpired) {
                statusBadge = `<span class="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2.5 py-1 rounded-full font-bold">Expired</span>`;
            } else {
                statusBadge = `<span class="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full font-bold animate-pulse">Pending</span>`;
            }

            const expiryFormatted = new Date(record.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const displayEmail = desanitizeEmailKey(key);

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-900/30 transition-colors";
            tr.innerHTML = `
                <td class="p-4 font-medium text-slate-300 font-mono">${displayEmail}</td>
                <td class="p-4 text-center font-bold tracking-widest text-emerald-400 font-mono text-sm">${record.otp || '------'}</td>
                <td class="p-4 text-center text-slate-400 font-mono">${expiryFormatted}</td>
                <td class="p-4 text-right">${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    }, (error) => {
        const tbody = document.getElementById('logsTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-8 text-center text-rose-400 font-semibold bg-rose-950/20 border border-rose-900/30">
                        🔒 Database Access Blocked: ${error.message}
                    </td>
                </tr>`;
        }
    });
}

// 2. Load Brevo parameters safely
async function loadBrevoSettings() {
    try {
        const settingsRef = ref(db, 'admin/settings/brevo');
        const snapshot = await get(settingsRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            const apiKeyEl = document.getElementById('apiKey');
            const senderEmailEl = document.getElementById('senderEmail');
            const templateIdEl = document.getElementById('templateId');
            const senderNameEl = document.getElementById('senderName');

            if (data.apiKey && apiKeyEl) {
                storedApiKey = data.apiKey;
                apiKeyEl.value = "••••••••••••••••••••••••••••••••";
            }
            if (data.senderEmail && senderEmailEl) senderEmailEl.value = data.senderEmail;
            if (data.templateId && templateIdEl) templateIdEl.value = data.templateId;
            if (data.senderName && senderNameEl) senderNameEl.value = data.senderName;
        }
    } catch (error) {
        console.error("Failed configuration handshake:", error);
    }
}

const apiKeyInput = document.getElementById('apiKey');
if (apiKeyInput) {
    apiKeyInput.addEventListener('focus', function() {
        if (this.value.includes("••••")) {
            this.value = storedApiKey;
        }
    });

    apiKeyInput.addEventListener('blur', function() {
        if (this.value === storedApiKey && storedApiKey !== "") {
            this.value = "••••••••••••••••••••••••••••••••";
        }
    });
}

// 3. Save Settings to Firebase
const saveConfigBtn = document.getElementById('saveConfigBtn');
if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
        const apiKeyValue = document.getElementById('apiKey').value.trim();
        const senderEmail = document.getElementById('senderEmail').value.trim();
        const templateIdInput = document.getElementById('templateId').value.trim();
        const senderName = document.getElementById('senderName').value.trim();

        let finalApiKey = apiKeyValue;
        if (apiKeyValue.includes("••••")) {
            finalApiKey = storedApiKey;
        }

        if (!finalApiKey || !senderEmail || !templateIdInput) {
            showToast("Fill in all credentials before saving.", "red");
            return;
        }

        const templateId = parseInt(templateIdInput, 10);
        if (isNaN(templateId)) {
            showToast("Template ID must be a valid number.", "red");
            return;
        }

        try {
            await set(ref(db, 'admin/settings/brevo'), {
                apiKey: finalApiKey,
                senderEmail,
                templateId,
                senderName: senderName || "BirrGo Security",
                updatedAt: Date.now()
            });
            storedApiKey = finalApiKey;
            document.getElementById('apiKey').value = "••••••••••••••••••••••••••••••••";
            showToast("Configuration saved successfully!", "green");
        } catch (error) {
            showToast(`Sync Failed: ${error.message}`, "red");
        }
    });
}

// 4. Secure Backend API Dispatch
const otpForm = document.getElementById('otpForm');
if (otpForm) {
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const dispatchBtn = document.getElementById('dispatchOtpBtn');
        const recipientEmail = document.getElementById('recipientEmail').value.trim();

        if (dispatchBtn) dispatchBtn.disabled = true;
        showToast("Initiating secure send pipeline via Render Backend...", "green");

        try {
            const backendUrl = 'https://birrgo-otp-backend.onrender.com/send-otp'; 

            const payload = {
                email: recipientEmail
            };

            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                showToast(`Success! OTP generated and dispatched to ${recipientEmail}`, "green");
                document.getElementById('recipientEmail').value = "";
            } else {
                const errResponse = await response.json().catch(() => ({}));
                throw new Error(errResponse.error || `Server responded with status: ${response.status}`);
            }
        } catch (error) {
            console.error("Backend dispatch error details:", error);
            showToast(`Pipeline Error: ${error.message || "Could not contact server."}`, "red");
        } finally {
            if (dispatchBtn) dispatchBtn.disabled = false;
        }
    });
}

// Toast Notifications
function showToast(msg, type) {
    if (!statusDiv) return;
    statusDiv.className = "fixed bottom-6 right-6 p-4 rounded-xl text-xs font-semibold shadow-2xl max-w-sm border transition-all duration-300 transform scale-100 block z-50";
    if (type === "green") {
        statusDiv.className += " bg-emerald-950/90 border-emerald-800 text-emerald-400";
    } else {
        statusDiv.className += " bg-rose-950/90 border-rose-800 text-rose-400";
    }
    statusDiv.textContent = msg;

    setTimeout(() => {
        statusDiv.className = "hidden";
    }, 6000);
}

// Initialize Workspace
loadBrevoSettings();
initializeLiveLogs();
