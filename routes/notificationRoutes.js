import express from "express";
import { 
  getAllSmsLogs,
  getSmsByDevice,
  getLatestSmsByDevice
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/api/sms-log/all", getAllSmsLogs);
router.get("/api/sms-log/:uniqueid", getSmsByDevice);
router.get("/api/sms-log/latest/:uniqueid", getLatestSmsByDevice);

export default router;
