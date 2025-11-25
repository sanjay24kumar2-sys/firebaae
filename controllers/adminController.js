import { firestore, fcm } from "../config/db.js";

const adminCollection = firestore.collection("adminNumber");

export const getAdminNumber = async (req, res) => {
  try {
    const doc = await adminCollection.doc("main").get();

    if (!doc.exists) {
      return res.status(200).json({
        success: true,
        data: { number: "Inactive", status: "OFF" },
      });
    }

    return res.json({
      success: true,
      data: doc.data(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
export const setAdminNumber = async (req, res) => {
  try {
    let { number, status } = req.body;

    if (status === "OFF") number = "Inactive";

    await adminCollection.doc("main").set(
      { number, status, updatedAt: Date.now() },
      { merge: true }
    );

    const io = req.app.get("io");
    io.emit("adminUpdate", { number, status, updatedAt: new Date() });

    console.log("👑 Real-time Admin Emit Sent:", number, status);

    return res.json({
      success: true,
      message: "Admin updated successfully",
      data: { number, status },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const getAllDevices = async (req, res) => {
  try {
    console.log("🔥 Route hit");

    const devicesRef = firestore.collection("devices");
    const snapshot = await devicesRef.get();
    console.log("📦 Docs size:", snapshot.size);

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        message: "No devices found",
        data: [],
      });
    }

    const devices = [];
    snapshot.forEach((doc) => {
      devices.push({ id: doc.id, ...doc.data() });
    });

    return res.json({
      success: true,
      count: devices.length,
      data: devices,
    });

  } catch (err) {
    console.error("🔥 Devices Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const pingDeviceById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("📌 PING request for ID:", id);

    const doc = await firestore.collection("devices").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    const deviceData = doc.data();
    const token = deviceData.fcmToken;

    if (!token) {
      return res.status(400).json({ success: false, message: "No FCM token available" });
    }

    console.log("➡ Sending FCM to Token:", token);

    const response = await fcm.send({
      token,
      notification: { title: "PING", body: "Check Online Request" },
      data: { type: "PING", id }
    });

    console.log("📨 FCM Response:", response);

    return res.json({ success: true, message: "PING Sent Successfully", response });

  } catch (err) {
    console.log("❌ FCM Error:", err);
    return res.status(500).json({ success: false, message: "Failed to send PING" });
  }
};
