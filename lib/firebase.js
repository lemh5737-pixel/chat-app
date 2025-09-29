// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC1JSKgz4RqMeYGOaa-V01Eg_bDqm5asyY",
  authDomain: "chat-app-e1b0f.firebaseapp.com",
  projectId: "chat-app-e1b0f",
  storageBucket: "chat-app-e1b0f.firebasestorage.app",
  messagingSenderId: "880491394759",
  appId: "1:880491394759:web:9975b478f57bc7abcfb0e2",
  measurementId: "G-NVK77C9HK0"
};

// Initialize Firebase
let app;
let database;
let analytics;

try {
  app = initializeApp(firebaseConfig);
  database = getDatabase(app, 'https://chat-app-e1b0f-default-rtdb.asia-southeast1.firebasedatabase.app/');
  
  console.log("Firebase initialized successfully");
  console.log("Database URL:", 'https://chat-app-e1b0f-default-rtdb.asia-southeast1.firebasedatabase.app/');
  
  // Initialize Analytics only on client side
  if (typeof window !== 'undefined') {
    import('firebase/analytics').then(({ getAnalytics }) => {
      analytics = getAnalytics(app);
      console.log("Firebase Analytics initialized");
    });
  }
} catch (error) {
  console.error("Error initializing Firebase:", error);
  // Fallback initialization
  app = initializeApp(firebaseConfig);
  database = getDatabase(app);
}

export { app, analytics, database };
