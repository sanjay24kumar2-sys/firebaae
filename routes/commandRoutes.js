import express from "express";
import {
  handleDeviceCommand,
  getAllCommands,
  getCommandsByDevice,
  getLatestCommandByDevice,
  getCommandLogs
} from "../controllers/commandController.js";

const router = express.Router();

router.post("/api/command", handleDeviceCommand);

router.get("/api/commands", getAllCommands);
router.get("/api/commands/:uniqueid", getCommandsByDevice);
router.get("/api/commands/latest/:uniqueid", getLatestCommandByDevice);

router.get("/api/command-logs", getCommandLogs);

export default router;
