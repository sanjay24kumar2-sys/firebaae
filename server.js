import dotenv from "dotenv";
dotenv.config(); // Load env first

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { firestore, rtdb, fcm } from "./config/db.js";
import adminRoutes from "./routes/adminRoutes.js";  // ⭐ IMPORT ROUTER
import smsRoutes from "./routes/notificationRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";

const PORT = process.env.PORT || 5000;
const app = express();
const server = createServer(app);

// Middlewares
app.use(cors());
app.use(express.json());

// SOCKET.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.set("io", io); // Allow socket emit in controllers

const deviceSockets = new Map();

// Utility
function clean(id) {
  return id?.toString()?.trim()?.toUpperCase();
}

// SOCKET EVENTS
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);
  let current = null;

  socket.on("registerDevice", (rawId) => {
    const id = clean(rawId);
    if (!id) return;

    deviceSockets.set(id, socket.id);
    current = id;

    console.log("📱 Device Registered:", id);
    io.to(socket.id).emit("deviceRegistered", id);

    rtdb.ref(`status/${id}`).set({
      connectivity: "Online",
      timestamp: Date.now(),
    });

    io.emit("deviceStatus", { id, connectivity: "Online" });
  });

  socket.on("disconnect", () => {
    if (current) {
      deviceSockets.delete(current);

      rtdb.ref(`status/${current}`).set({
        connectivity: "Offline",
        timestamp: Date.now(),
      });

      io.emit("deviceStatus", { id: current, connectivity: "Offline" });
    }
  });
});

// COMMAND ROUTE
app.post("/send-command", async (req, res) => {
  try {
    const { uniqueid, title, message } = req.body;
    const id = clean(uniqueid);

    await rtdb.ref(`commands/${id}`).set({
      title,
      message,
      timestamp: Date.now(),
    });

    console.log("📩 Command sent →", id, message);
    return res.json({ success: true });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.use(adminRoutes); 
app.use(smsRoutes);
app.use(commandRoutes);

app.get("/", (_, res) => res.send("🔥 Firebase Firestore & Socket Backend Running"));

server.listen(PORT, () => console.log(`🚀 Server running on PORT ${PORT}`));
