import express from "express";
import { getAdminNumber, setAdminNumber, getAllDevices,pingDeviceById } from "../controllers/adminController.js";

const router = express.Router();
const base = "/api/admin-number";

router.get(base, getAdminNumber);
router.post(base, setAdminNumber);

router.get("/api/devices", getAllDevices);
router.post("/api/ping-device/:id", pingDeviceById);

export default router;