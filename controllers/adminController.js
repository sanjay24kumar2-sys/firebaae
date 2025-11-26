import { rtdb, fcm } from "../config/db.js";

const ADMIN_NODE = "adminNumber";
const DEVICE_NODE = "registeredDevices";   // ⭐ FIXED NODE

/* ============================================================
   ⭐ GET ADMIN NUMBER (RTDB)
============================================================ */
export const getAdminNumber = async (req, res) => {
  try {
    const snap = await rtdb.ref(`${ADMIN_NODE}/main`).get();

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
   ⭐ SET ADMIN NUMBER (RTDB)
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

    await rtdb.ref(`${ADMIN_NODE}/main`).set(data);

    // SOCKET BROADCAST
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

export const getAllDevices = async (req, res) => {
  try {
    console.log("📌 Fetching devices from registeredDevices");

    const snap = await rtdb.ref(DEVICE_NODE).get();

    if (!snap.exists()) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const data = snap.val();

    const devices = Object.entries(data).map(([id, obj]) => ({
      id,
      ...obj,
    }));

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

export const pingDeviceById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("📡 PING request for:", id);

    const snap = await rtdb.ref(`${DEVICE_NODE}/${id}`).get();

    if (!snap.exists()) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    const device = snap.val();
    const token = device.fcmToken;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "No FCM token available"
      });
    }

    console.log("➡ Sending FCM Ping to:", token);

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

    console.log("📨 FCM Response:", response);

    return res.json({
      success: true,
      message: "PING Sent Successfully",
      response,
    });

  } catch (err) {
    console.log("❌ FCM Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send PING",
    });
  }
};
