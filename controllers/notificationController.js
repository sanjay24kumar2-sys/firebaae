import { firestore } from "../config/db.js";

const smsLogsCollection = firestore.collection("smsLogs");

// GET ALL SMS
export const getAllSmsLogs = async (req, res) => {
  try {
    const snapshot = await smsLogsCollection
      .orderBy("timestamp", "desc")
      .get();

    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET BY DEVICE ID
export const getSmsByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snapshot = await smsLogsCollection
      .where("uniqueid", "==", uniqueid)
      .orderBy("timestamp", "desc")
      .get();

    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET LATEST SMS
export const getLatestSmsByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snapshot = await smsLogsCollection
      .where("uniqueid", "==", uniqueid)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    const latest = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data: latest });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching latest SMS" });
  }
};