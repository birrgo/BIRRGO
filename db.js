import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get, onValue, runTransaction, push, set, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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

// Initialize Firebase App Instance
const app = initializeApp(firebaseConfig);

// Core Services Instances
export const db = getDatabase(app);
export const storage = getStorage(app);

/**
 * Universal Utility: Generates a clean, strictly typed numerical Unix Epoch integer.
 * Use this whenever writing 'sortingTime' to Firebase across your admin panel scripts.
 * @returns {number}
 */
export const getNumericTimestamp = () => Date.now();

// Clean Module Re-Exports Framework
// Explicitly exporting individual elements keeps GitHub Pages / browser engines stable
export { 
    ref, 
    get, 
    onValue, 
    runTransaction, 
    push, 
    set, 
    remove, 
    storageRef, 
    uploadBytes, 
    getDownloadURL 
};
