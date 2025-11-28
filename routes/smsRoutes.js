import express from "express";
import {
  getAllSmsLogs,
  getSmsByDevice,
  getLatestSmsByDevice
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/all", getAllSmsLogs);
router.get("/:uniqueid", getSmsByDevice);
router.get("/latest/:uniqueid", getLatestSmsByDevice);

export default router;