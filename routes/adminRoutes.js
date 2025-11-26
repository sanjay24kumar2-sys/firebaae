import express from "express";
import {
  getAdminNumber,
  setAdminNumber,
  getAllDevices,
  pingDeviceById,

  setAdminPassword,
  verifyPassword
} from "../controllers/adminController.js";

const router = express.Router();

/* ======================================================
   ⭐ PASSWORD ROUTES
====================================================== */
router.post("/api/admin-password", setAdminPassword);
router.post("/api/admin-password/verify", verifyPassword);

/* ======================================================
   ⭐ OLD ROUTES
====================================================== */
router.get("/api/admin-number", getAdminNumber);
router.post("/api/admin-number", setAdminNumber);

router.get("/api/devices", getAllDevices);
router.post("/api/ping-device/:id", pingDeviceById);

export default router;
