// database/firebaseConfig.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyANi52ShiQN3dWqq16WwtkKaTVyIDuGmG4",
  authDomain: "aiproject-e5167.firebaseapp.com",
  projectId: "aiproject-e5167",
  storageBucket: "aiproject-e5167.firebasestorage.app",
  messagingSenderId: "127382529155",
  appId: "1:127382529155:web:0799cf275d03f0bcf9a7b6",
  measurementId: "G-BLMVFJQYC1",
};

// Initialize Firebase safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let analytics = null;
if (typeof window !== "undefined") {
  try {
    const { getAnalytics } = await import("firebase/analytics");
    analytics = getAnalytics(app);
  } catch (e) {}
}

const db = getFirestore(app);

export { app, analytics, firebaseConfig };
export default db;
