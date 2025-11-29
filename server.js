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

/* ---------------- SOCKET.IO SETUP ---------------- */
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.set("io", io);

const deviceSockets = new Map();
let lastDevicesList = [];

/* ---------------- ID Cleaner ---------------- */
const clean = (id) => id?.toString()?.trim()?.toUpperCase();

/* ======================================================
      HIGH PRIORITY FCM PUSHER
====================================================== */
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

/* ======================================================
      CHECK ONLINE RATE LIMIT (30s)
====================================================== */

const lastCheckOnlineTime = {}; // { uid: timestamp }
const CHECK_ONLINE_COOLDOWN = 30 * 1000; // 30 sec

async function safeSendCheckOnlineFCM(uid) {
  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) return;

  const now = Date.now();

  // cooldown check
  if (lastCheckOnlineTime[uid] && now - lastCheckOnlineTime[uid] < CHECK_ONLINE_COOLDOWN) {
    const wait = ((CHECK_ONLINE_COOLDOWN - (now - lastCheckOnlineTime[uid])) / 1000).toFixed(1);
    console.log(`⏳ CHECK_ONLINE BLOCKED for ${uid}. Wait ${wait}s`);
    return;
  }

  lastCheckOnlineTime[uid] = now;

  await sendFcmHighPriority(token, "CHECK_ONLINE", { uniqueid: uid });

  console.log(`🚀 CHECK_ONLINE SENT → ${uid}`);
}

/* ======================================================
      FRONTEND → USER REQUEST API (CHECK ONLINE)
====================================================== */

app.get("/api/checkonline/:uid", async (req, res) => {
  const uid = clean(req.params.uid);

  await safeSendCheckOnlineFCM(uid);

  return res.json({
    success: true,
    message: "Check Online triggered (rate-limited 30s)",
  });
});

/* ======================================================
      BUILD DEVICES LIST (registeredDevices + status)
====================================================== */
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

/* ======================================================
      REFRESH DEVICES LIVE
====================================================== */
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

/* ======================================================
      SOCKET.IO CONNECTION HANDLING
====================================================== */

io.on("connection", (socket) => {
  console.log("🔗 Client Connected:", socket.id);

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

    console.log("📱 Device Registered via Socket:", id);

    await rtdb.ref(`status/${id}`).set({
      connectivity: "Online",
      lastSeen: Date.now(),
      timestamp: Date.now(),
    });

    io.emit("deviceStatus", { id, connectivity: "Online" });

    refreshDevicesLive(`deviceOnline:${id}`);
  });

  socket.on("disconnect", async () => {
    console.log("🔌 Client Disconnected:", socket.id);
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

/* ======================================================
      BRO_REPLY LIVE LISTENER (NO FCM HERE)
====================================================== */

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
    const data = snap.exists() ? snap.val() : null;

    io.emit("brosReplyUpdate", {
      uid,
      success: true,
      data,
    });

    console.log("🔥 brosReply:", uid, data);
  });

  liveReplyWatchers.set(uid, ref);
}

app.get("/api/brosreply/:uid", async (req, res) => {
  const uid = req.params.uid;

  stopReplyWatcher(uid);
  startReplyWatcher(uid);

  const snap = await rtdb.ref(`checkOnline/${uid}`).get();
  const data = snap.exists() ? snap.val() : null;

  res.json({ success: true, data });
});

/* ======================================================
      DEVICE COMMAND CENTER (NO CHANGE)
====================================================== */

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

/* ======================================================
      STATUS UPDATE (NO FCM REPLY)
====================================================== */
async function handleCheckOnlineChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;

  const now = Date.now();

  await rtdb.ref(`status/${uid}`).update({
    connectivity: "Online",
    lastSeen: now,
    timestamp: now,
  });

  console.log(`♻ STATUS UPDATED for ${uid}`);
}

rtdb.ref("checkOnline").on("child_changed", handleCheckOnlineChange);

/* ======================================================
      OTHER ROUTES
====================================================== */

app.use(adminRoutes);
app.use("/api/sms", notificationRoutes);
app.use("/api", checkRoutes);
app.use("/api", userFullDataRoutes);
app.use(commandRoutes);

app.get("/", (_, res) => {
  res.send("RTDB + Socket.IO Backend Running");
});

server.listen(PORT, () => {
  console.log(` Server running on PORT ${PORT}`);
});
