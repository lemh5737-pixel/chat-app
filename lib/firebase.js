// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyARixzTagIzkPVwGIs9S7tUOXt1pfStdaU",
  authDomain: "vorchat-app.firebaseapp.com",
  databaseURL: "https://vorchat-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "vorchat-app",
  storageBucket: "vorchat-app.firebasestorage.app",
  messagingSenderId: "737922986459",
  appId: "1:737922986459:web:e86d7218374f13c29377fe",
  measurementId: "G-CNKYCGWPQB"
};

// Initialize Firebase
let app;
let database;
let analytics;

try {
  app = initializeApp(firebaseConfig);
  database = getDatabase(app, 'https://vorchat-app-default-rtdb.asia-southeast1.firebasedatabase.app/');
  
  console.log("Firebase initialized successfully");
  console.log("Database URL:", 'https://vorchat-app-default-rtdb.asia-southeast1.firebasedatabase.app/');
  
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
