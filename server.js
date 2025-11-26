import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { firestore, rtdb, fcm } from "./config/db.js";

import adminRoutes from "./routes/adminRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";

const PORT = process.env.PORT || 5000;
const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// SOCKET.IO SETUP
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.set("io", io);

const deviceSockets = new Map();

function clean(id) {
  return id?.toString()?.trim()?.toUpperCase();
}

io.on("connection", (socket) => {
  console.log("🔗 Connected:", socket.id);
  let current = null;

  socket.on("registerDevice", async (rawId) => {
    const id = clean(rawId);
    if (!id) return;

    deviceSockets.set(id, socket.id);
    current = id;

    console.log("📱 Device Registered:", id);

    io.to(socket.id).emit("deviceRegistered", id);

    await rtdb.ref(`status/${id}`).set({
      connectivity: "Online",
      timestamp: Date.now(),
    });

    io.emit("deviceStatus", { id, connectivity: "Online" });
  });

  socket.on("disconnect", async () => {
    if (current) {
      deviceSockets.delete(current);

      await rtdb.ref(`status/${current}`).set({
        connectivity: "Offline",
        timestamp: Date.now(),
      });

      io.emit("deviceStatus", {
        id: current,
        connectivity: "Offline",
      });
    }
  });
});

// OLD SEND COMMAND (KEEP OR REMOVE)
app.post("/send-command", async (req, res) => {
  try {
    const { uniqueid, title, message } = req.body;
    const id = clean(uniqueid);

    if (!id) return res.status(400).json({ error: "Invalid uniqueid" });

    await rtdb.ref(`commands/${id}`).set({
      title: title || "Command",
      message: message || "",
      timestamp: Date.now(),
    });

    console.log("📩 Command sent →", id, message);

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ROUTES
app.use(adminRoutes);
app.use(notificationRoutes);    // ⭐ notification routes
app.use(commandRoutes);

app.get("/", (_, res) => {
  res.send("🔥 RTDB + Socket.IO Backend Running");
});

server.listen(PORT, () =>
  console.log(`🚀 Server running on PORT ${PORT}`)
);
