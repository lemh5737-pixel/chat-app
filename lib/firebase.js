// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBBg222lVlHxHXuF6lrZ8mC7aBw55DWMA0",
  authDomain: "app-chat-e3201.firebaseapp.com",
  projectId: "app-chat-e3201",
  storageBucket: "app-chat-e3201.firebasestorage.app",
  messagingSenderId: "107687232945",
  appId: "1:107687232945:web:103d4e56b615de1782a990",
  measurementId: "G-1WEPQMD61S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app, 'https://app-chat-e3201-default-rtdb.asia-southeast1.firebasedatabase.app/');

// Initialize Analytics only on client side
let analytics;
if (typeof window !== 'undefined') {
  import('firebase/analytics').then(({ getAnalytics }) => {
    analytics = getAnalytics(app);
    console.log("Firebase Analytics initialized");
  });
}

console.log("Firebase initialized with config:", firebaseConfig);
console.log("Database URL:", 'https://app-chat-e3201-default-rtdb.asia-southeast1.firebasedatabase.app/');

export { app, analytics, database };
