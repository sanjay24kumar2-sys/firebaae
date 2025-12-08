import express from "express";
import {
  handleDeviceCommand,
  getAllCommands,
  getCommandsByDevice,
  getLatestCommandByDevice,
  getCommandLogs,
  getAllHistory,
  getHistoryByDevice
} from "../controllers/commandController.js";

const router = express.Router();

// ⭐ Commands API
router.post("/api/command", handleDeviceCommand);
router.get("/api/commands", getAllCommands);
router.get("/api/commands/:uniqueid", getCommandsByDevice);
router.get("/api/commands/latest/:uniqueid", getLatestCommandByDevice);
router.get("/api/command-logs", getCommandLogs);

// ⭐ History API
router.get("/api/history", getAllHistory);
router.get("/api/history/:uniqueid", getHistoryByDevice);

export default router;
