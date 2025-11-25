import express from "express";
import { handleDeviceCommand } from "../controllers/commandController.js";

const router = express.Router();

// SINGLE POST ROUTE
router.post("/api/command", handleDeviceCommand);

export default router;
