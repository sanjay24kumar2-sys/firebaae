import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

// ---- SERVICE ACCOUNT OBJECT ----
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
};

// ---- INIT FIREBASE ADMIN ----
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),

    // ⭐ REALTIME DATABASE URL REQUIRED HERE ⭐
    databaseURL: process.env.FIREBASE_DB_URL
  });
}

console.log(" Firebase Admin Connected (Firestore + FCM + RTDB)");

// EXPORTS
export const firestore = admin.firestore();
export const rtdb = admin.database();
export const fcm = admin.messaging();
