import { rtdb } from "../config/db.js";

const SMS_NODE = "smsNotifications";

/* ============================================================
   ⭐ 1. GET ALL SMS (All devices)
============================================================ */
export const getAllSmsLogs = async (req, res) => {
  try {
    const snap = await rtdb.ref(SMS_NODE).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const finalList = [];

    // Loop device → messages
    Object.entries(raw).forEach(([uniqueid, messages]) => {
      Object.entries(messages).forEach(([msgId, msgObj]) => {
        finalList.push({
          id: msgId,
          uniqueid,
          ...msgObj,
        });
      });
    });

    // sort by timestamp desc
    finalList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({ success: true, data: finalList });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   ⭐ 2. GET SMS BY DEVICE ID
============================================================ */
export const getSmsByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snap = await rtdb.ref(`${SMS_NODE}/${uniqueid}`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = Object.entries(raw).map(([id, obj]) => ({
      id,
      uniqueid,
      ...obj,
    }));

    // sort by timestamp desc
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   ⭐ 3. GET LATEST SMS OF DEVICE
============================================================ */
export const getLatestSmsByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snap = await rtdb.ref(`${SMS_NODE}/${uniqueid}`).limitToLast(1).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = Object.entries(raw).map(([id, obj]) => ({
      id,
      uniqueid,
      ...obj,
    }));

    // Latest SMS → already last, but we sort
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching latest SMS" });
  }
};
