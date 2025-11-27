import express from "express";
import {
  getAllUsersFullData,
  getUserFullData,
  getLatestForm,
  getAllData
} from "../controllers/userFullDataController.js";

const router = express.Router();

router.get("/all-data", getAllData);

router.get("/all-users-full", getAllUsersFullData);
router.get("/user-full/:uniqueid", getUserFullData);
router.get("/latest-form/:uniqueid", getLatestForm);

export default router;