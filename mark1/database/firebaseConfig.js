// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export default db;
