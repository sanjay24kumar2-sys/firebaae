import express from "express";
import {
  getAllSmsLogs,
  getSmsByDevice,
  getLatestSmsByDevice
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/api/sms/all", getAllSmsLogs);
router.get("/api/sms/:uniqueid", getSmsByDevice);
router.get("/api/sms/latest/:uniqueid", getLatestSmsByDevice);

export default router;