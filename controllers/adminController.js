// controllers/adminController.js
import { rtdb, fcm } from "../config/db.js";

const ADMIN_NODE = "adminNumber";
const DEVICE_NODE = "registeredDevices";
const PASSWORD_NODE = "adminPassword"; 

/* ============================================================
   ⭐ SET / CHANGE ADMIN PASSWORD
============================================================ */
export const setAdminPassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 4 characters"
      });
    }

    const data = {
      password,
      updatedAt: Date.now(),
    };

    await rtdb.ref(PASSWORD_NODE).set(data);

    console.log("🔐 Admin Password Updated:", data);

    return res.json({
      success: true,
      message: "Password updated successfully",
      data,
    });

  } catch (err) {
    console.error("❌ Password Update Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   ⭐ VERIFY PASSWORD (AUTO CREATE ON FIRST TIME)
============================================================ */
export const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Password required"
      });
    }

    const snap = await rtdb.ref(PASSWORD_NODE).get();

    // ⭐ FIRST TIME LOGIN → AUTO SET THE ENTERED PASSWORD
    if (!snap.exists()) {
      const data = {
        password,
        updatedAt: Date.now(),
      };

      await rtdb.ref(PASSWORD_NODE).set(data);

      console.log("🔐 First-Time Password Set:", data);

      return res.json({
        success: true,
        firstTime: true,
        message: "New password created and verified",
        data,
      });
    }

    const savedPassword = snap.val().password;

    if (password !== savedPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    return res.json({
      success: true,
      firstTime: false,
      message: "Password verified successfully",
    });

  } catch (err) {
    console.error("❌ Verify Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   ⭐ GET ADMIN NUMBER  (ONLY PATH UPDATED)
============================================================ */
export const getAdminNumber = async (req, res) => {
  try {
    // ⭐ NEW UPDATED COLLECTION PATH
    const snap = await rtdb.ref(`commandCenter/admin/main`).get();
    // sirf yahi line change hui hai mere bhai ❤️

    if (!snap.exists()) {
      return res.json({
        success: true,
        data: { number: "Inactive", status: "OFF" }
      });
    }

    return res.json({
      success: true,
      data: snap.val(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   ⭐ SET ADMIN NUMBER
============================================================ */
export const setAdminNumber = async (req, res) => {
  try {
    let { number, status } = req.body;
    if (status === "OFF") number = "Inactive";

    const data = {
      number,
      status,
      updatedAt: Date.now(),
    };

    // ⭐ NEW PATH (ONLY THIS LINE CHANGED)
    await rtdb.ref(`commandCenter/admin/main`).set(data);

    const io = req.app.get("io");
    io.emit("adminUpdate", data);

    console.log("🟢 Admin Updated:", data);

    return res.json({
      success: true,
      message: "Admin updated successfully",
      data,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   ⭐ GET ALL DEVICES  → LIVE STATUS MERGED
   - registeredDevices + status node merge
   - Same shape as Socket.IO devicesLive event
============================================================ */
export const getAllDevices = async (req, res) => {
  try {
    console.log("📌 Fetching devices (HTTP)");

    const [devSnap, statusSnap] = await Promise.all([
      rtdb.ref(DEVICE_NODE).get(),
      rtdb.ref("status").get(),
    ]);

    if (!devSnap.exists()) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const statusMap = statusSnap.exists() ? statusSnap.val() : {};

    const devices = Object.entries(devSnap.val()).map(([id, obj]) => {
      const st = statusMap[id] || {};
      return {
        id,
        ...obj,
        connectivity: st.connectivity || "Offline",
        lastSeen: st.timestamp || null,
      };
    });

    return res.json({
      success: true,
      count: devices.length,
      data: devices,
    });

  } catch (err) {
    console.error("❌ Devices Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ============================================================
   ⭐ PING DEVICE (OLD)
============================================================ */
export const pingDeviceById = async (req, res) => {
  try {
    const { id } = req.params;

    const snap = await rtdb.ref(`${DEVICE_NODE}/${id}`).get();

    if (!snap.exists()) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    const token = snap.val().fcmToken;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "No FCM token available"
      });
    }

    const response = await fcm.send({
      token,
      notification: {
        title: "PING",
        body: "Check Online Request",
      },
      data: {
        type: "PING",
        id,
      }
    });

    return res.json({
      success: true,
      message: "PING Sent Successfully",
      response,
    });

  } catch (err) {
    console.log(" FCM Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send PING",
    });
  }
};
