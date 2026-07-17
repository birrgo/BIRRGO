import { 
    db, 
    ref, 
    get, 
    set, 
    runTransaction, 
    push 
} from "./db.js";

import { 
    query, 
    orderByChild, 
    equalTo 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const countries = [
    { name: "Ethiopia", code: "+251", flag: "🇪🇹" },
    { name: "Kenya", code: "+254", flag: "🇰🇪" },
    { name: "United States", code: "+1", flag: "🇺🇸" },
    { name: "United Kingdom", code: "+44", flag: "🇬🇧" },
    { name: "United Arab Emirates", code: "+971", flag: "🇦🇪" },
    { name: "Sudan", code: "+249", flag: "🇸🇩" },
    { name: "Somalia", code: "+252", flag: "🇸🇴" },
    { name: "Djibouti", code: "+253", flag: "🇩🇯" },
    { name: "Uganda", code: "+256", flag: "🇺🇬" },
    { name: "Tanzania", code: "+255", flag: "🇹🇿" },
    { name: "Nigeria", code: "+234", flag: "🇳🇬" },
    { name: "Ghana", code: "+233", flag: "🇬🇭" },
    { name: "South Africa", code: "+27", flag: "🇿🇦" },
    { name: "Saudi Arabia", code: "+966", flag: "🇸🇦" },
    { name: "Canada", code: "+1", flag: "🇨🇦" },
    { name: "Germany", code: "+49", flag: "🇩🇪" },
    { name: "France", code: "+33", flag: "🇫🇷" },
    { name: "India", code: "+91", flag: "🇮🇳" },
    { name: "China", code: "+86", flag: "🇨🇳" },
    { name: "Australia", code: "+61", flag: "🇦🇺" }
];

let activeSelectedPrefix = "+251";
const overlay = document.getElementById('countryModalOverlay');
const listScrollContainer = document.getElementById('countryListScroll');
const searchInput = document.getElementById('modalSearchInput');

let signupPayload = {};
let countdownTimer;

function sanitizeEmail(email) {
    return email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_at_');
}

function populateCountries(filterText = "") {
    listScrollContainer.innerHTML = "";
    const cleanFilter = filterText.toLowerCase().trim();
    
    const filtered = countries.filter(c => 
        c.name.toLowerCase().includes(cleanFilter) || 
        c.code.includes(cleanFilter)
    );

    filtered.forEach(country => {
        const row = document.createElement('div');
        row.className = 'country-item';
        row.innerHTML = `
            <span class="item-flag">${country.flag}</span>
            <span class="item-name">${country.name}</span>
            <span class="item-code">${country.code}</span>
        `;
        row.addEventListener('click', () => {
            document.getElementById('currentFlag').innerText = country.flag;
            document.getElementById('currentCode').innerText = country.code;
            activeSelectedPrefix = country.code;
            closeCountryModal();
        });
        listScrollContainer.appendChild(row);
    });
}

function openCountryModal() {
    populateCountries();
    searchInput.value = "";
    overlay.classList.add('active');
}

function closeCountryModal() {
    overlay.classList.remove('active');
}

document.getElementById('countryTriggerBtn').addEventListener('click', openCountryModal);
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCountryModal();
});
searchInput.addEventListener('input', (e) => {
    populateCountries(e.target.value);
});

let referrerAccountId = "";
document.addEventListener('DOMContentLoaded', () => {
    // FIX: Set explicit routing state to prevent external index redirection conflicts
    localStorage.setItem('birrgo_last_page', 'register.html');

    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');
    if (refParam) {
        referrerAccountId = refParam.trim();
        if (referrerAccountId) {
            document.getElementById('referrer-label').innerHTML = `Invited by User: <span style="color:var(--primary-burgundy);font-weight:700;">${referrerAccountId}</span>`;
        }
    }
});

document.getElementById('regPhone').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
});

function showNotification(message, isSuccess = false) {
    const toast = document.getElementById('toast-message');
    toast.innerText = message;
    toast.style.background = isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(223, 34, 34, 0.95)';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

document.getElementById('navBackBtn').addEventListener('click', () => {
    const signupForm = document.getElementById('signupForm');
    const otpView = document.getElementById('otpView');
    
    if (otpView.style.display === 'flex') {
        otpView.style.display = 'none';
        signupForm.style.display = 'flex';
        
        document.getElementById('stepDot1').className = 'step-dot-active';
        document.getElementById('stepDot2').className = 'step-dot';
        document.getElementById('screen-title').innerText = "Create Your Account";
        
        clearInterval(countdownTimer);
    } else {
        window.location.href = "index.html"; 
    }
});

const otpInputs = document.querySelectorAll('.otp-input');
otpInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        if (e.target.value.length === 1 && index < otpInputs.length - 1) {
            otpInputs[index + 1].focus();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
            otpInputs[index - 1].focus();
        }
    });
});

async function sendVerificationOtp(email) {
    try {
        const backendUrl = 'https://birrgo-otp-backend.onrender.com/send-otp'; 

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: email.toLowerCase() })
        }).catch(() => {
            throw new Error("Unable to contact verification servers. Check your connection.");
        });

        if (response.ok) {
            showNotification(`Verification code sent successfully to ${email}`, true);
            startCountdown();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server Error (${response.status})`);
        }

    } catch (error) {
        console.error("OTP Delivery Exception:", error);
        showNotification(`Email Dispatch Error: ${error.message}`);
    }
}

function startCountdown() {
    const resendBtn = document.getElementById('resendCodeBtn');
    resendBtn.classList.add('disabled');
    let timer = 30;
    
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        timer--;
        resendBtn.innerText = `Resend in (${timer}s)`;
        if (timer <= 0) {
            clearInterval(countdownTimer);
            resendBtn.innerText = "Resend Code";
            resendBtn.classList.remove('disabled');
        }
    }, 1000);
}

document.getElementById('resendCodeBtn').addEventListener('click', function() {
    if (!this.classList.contains('disabled')) {
        sendVerificationOtp(signupPayload.email);
    }
});

document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const rawPhone = document.getElementById('regPhone').value.trim();
    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pin = document.getElementById('regPin').value;
    const confirmPin = document.getElementById('regConfirmPin').value;

    let cleanPhone = rawPhone.replace(/^0+/, '');
    
    if (cleanPhone.length < 6 || cleanPhone.length > 14) {
        showNotification("Please enter a valid phone number.");
        return;
    }

    const nameParts = fullName.split(/\s+/).filter(part => part.length > 0);
    if (nameParts.length !== 3) {
        showNotification("Please enter exactly 3 names: First, Middle, and Last name.");
        return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        showNotification("Please enter a valid email address.");
        return;
    }

    /* CHANGED: PIN length validation changed from 4 to 6 */
    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
        showNotification("PIN must be a secure 6-digit combination.");
        return;
    }
    if (pin !== confirmPin) {
        showNotification("PIN configurations do not match.");
        return;
    }

    try {
        submitBtn.disabled = true;
        submitBtn.innerText = "Checking Availability...";

        const userSnapshot = await get(ref(db, 'users/' + cleanPhone));

        if (userSnapshot.exists()) {
            showNotification("An account already exists with this phone number.");
            submitBtn.disabled = false;
            submitBtn.innerText = "Continue to Verification";
            return;
        }

        signupPayload = {
            cleanPhone,
            fullName,
            email,
            pin,
            firstNameOnly: nameParts[0],
            formatGlobalPhone: activeSelectedPrefix + cleanPhone
        };

        document.getElementById('signupForm').style.display = 'none';
        document.getElementById('otpView').style.display = 'flex';
        
        document.getElementById('stepDot1').className = 'step-dot';
        document.getElementById('stepDot2').className = 'step-dot-active';
        document.getElementById('screen-title').innerText = "Verify Your Email";
        document.getElementById('referrer-label').innerHTML = `Enter the 6-digit code sent to <strong style="color:var(--primary-burgundy);">${email}</strong>`;

        await sendVerificationOtp(email);

    } catch (error) {
        console.error("Firebase read failure: ", error);
        showNotification("Network error. Try checking your connection.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Continue to Verification";
    }
});

document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
    let enteredOtp = "";
    otpInputs.forEach(input => enteredOtp += input.value);

    if (enteredOtp.length !== 6) {
        showNotification("Please enter all 6 digits of the OTP.");
        return;
    }

    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const sanitizedEmailKey = sanitizeEmail(signupPayload.email);

    try {
        verifyOtpBtn.disabled = true;
        verifyOtpBtn.innerText = "Verifying...";

        const otpSnapshot = await get(ref(db, `otps/${sanitizedEmailKey}`));

        if (!otpSnapshot.exists()) {
            showNotification("Verification details expired. Resend code.");
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.innerText = "Verify OTP & Create Account";
            return;
        }

        const dbOtpRecord = otpSnapshot.val();

        if (Date.now() > dbOtpRecord.expiresAt) {
            showNotification("This code has expired. Please request a new one.");
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.innerText = "Verify OTP & Create Account";
            return;
        }

        if (enteredOtp !== dbOtpRecord.otp) {
            showNotification("Incorrect verification code. Try again.");
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.innerText = "Verify OTP & Create Account";
            return;
        }

        verifyOtpBtn.innerText = "Creating Account...";

        await set(ref(db, `otps/${sanitizedEmailKey}/verified`), true);

        const cleanPhone = signupPayload.cleanPhone;
        const final6Reversed = cleanPhone.slice(-6).split('').reverse().join('');
        const computedCardNumber = cleanPhone + final6Reversed;

        let finalizedUserNumber = 1000; 
        try {
            const globalCounterRef = ref(db, 'new/globalUserCounter');
            const txResult = await runTransaction(globalCounterRef, (currentValue) => {
                let parsedValue = parseInt(currentValue);
                if (isNaN(parsedValue) || parsedValue < 1000) {
                    return 1001;
                }
                return parsedValue + 1;
            });
            if (txResult.committed) {
                finalizedUserNumber = txResult.snapshot.val() - 1;
            }
        } catch (counterErr) {
            console.error("Counter fallback logic run.", counterErr);
        }

        const userPayload = {
            phoneNumber: signupPayload.formatGlobalPhone,
            localPhoneRef: cleanPhone,
            emailAddress: signupPayload.email,
            firstName: signupPayload.firstNameOnly,
            fullName: signupPayload.fullName,
            securityPin: signupPayload.pin,
            walletBalance: 0.00,
            userNumber: finalizedUserNumber,
            accountId: "BG-" + finalizedUserNumber, 
            cardNumber: computedCardNumber, 
            createdAt: new Date().toISOString()
        };

        await set(ref(db, 'users/' + cleanPhone), userPayload);

        if (referrerAccountId) {
            try {
                const usersRef = ref(db, 'users');
                const referralQuery = query(usersRef, orderByChild('accountId'), equalTo(referrerAccountId));
                const querySnapshot = await get(referralQuery);

                if (querySnapshot.exists()) {
                    let inviterPhoneNode = "";
                    
                    querySnapshot.forEach((child) => {
                        inviterPhoneNode = child.key; 
                    });

                    if (inviterPhoneNode && inviterPhoneNode !== cleanPhone) {
                        const inviterBalanceRef = ref(db, `users/${inviterPhoneNode}/walletBalance`);
                        const inviterTxRef = ref(db, `users/${inviterPhoneNode}/transactions`);
                        const referredHistoryRef = ref(db, `users/${inviterPhoneNode}/referredUsers`);
                        
                        const fixedBonus = 50.00; 

                        await runTransaction(inviterBalanceRef, (currentBalance) => {
                            let parsedBalance = parseFloat(currentBalance);
                            if (isNaN(parsedBalance)) parsedBalance = 0;
                            return parsedBalance + fixedBonus;
                        });

                        const now = new Date();
                        const walletFormattedTime = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + 
                                                   now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

                        const newTxNode = push(inviterTxRef);
                        await set(newTxNode, {
                            title: `Referral Bonus (${signupPayload.firstNameOnly})`,
                            amount: fixedBonus,
                            type: "income",
                            timestamp: walletFormattedTime
                        });

                        const historyLogNode = push(referredHistoryRef);
                        await set(historyLogNode, {
                            fullName: signupPayload.fullName,
                            phone: cleanPhone,
                            timestamp: walletFormattedTime
                        });
                    }
                }
            } catch (referralError) {
                console.error("Referral Engine Error: ", referralError);
            }
        }

        showNotification("Account verified & created successfully!", true);
        localStorage.setItem('auth_session_phone', cleanPhone);

        // FIX: Prior to leaving the page, switch tracking explicitly to target destination
        localStorage.setItem('birrgo_last_page', 'dashboard.html');

        setTimeout(() => {
            window.location.href = "dashboard.html"; 
        }, 1500);

    } catch (error) {
        console.error("Database Write Error: ", error);
        showNotification("Connection lost. Please try again.");
        verifyOtpBtn.disabled = false;
        verifyOtpBtn.innerText = "Verify OTP & Create Account";
    }
});
