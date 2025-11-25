import express from "express";
import { getAdminNumber, setAdminNumber } from "../controllers/adminController.js";

const router = express.Router();
const base = "/api/admin-number";

router.get(base, getAdminNumber);
router.post(base, setAdminNumber);

export default router;
