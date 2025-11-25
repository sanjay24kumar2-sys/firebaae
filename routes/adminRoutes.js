import express from "express";
import admin from "../config/firebase.js";  // <- make sure firebase admin import
import { getAdminNumber, setAdminNumber, getAllDevices } from "../controllers/adminController.js";

const router = express.Router();
const base = "/api/admin-number";

router.get(base, getAdminNumber);
router.post(base, setAdminNumber);

// Devices List
router.get("/api/devices", getAllDevices);

// ---- PING DEVICES (SEND FCM) ----
router.post("/api/ping-devices", async (req, res) => {
  const { tokens } = req.body;

  const payload = {
    notification: { title: "PING", body: "Check Online Request" },
    data: { type: "PING" },
  };

  try {
    for (const t of tokens) {
      await admin.messaging().sendToDevice(t, payload);
    }

    return res.json({ success: true, message: "Pings sent successfully" });

  } catch (err) {
    console.log("FCM send error:", err);
    return res.status(500).json({ success: false, message: "Failed to send PING" });
  }
});

export default router;
