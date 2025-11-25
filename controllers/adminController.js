import { firestore } from "../config/db.js";

const adminCollection = firestore.collection("adminNumber");

// GET ADMIN NUMBER
export const getAdminNumber = async (req, res) => {
  try {
    const doc = await adminCollection.doc("main").get();

    if (!doc.exists) {
      return res.status(200).json({
        success: true,
        data: { number: "Inactive", status: "OFF" },
      });
    }

    return res.json({
      success: true,
      data: doc.data(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
export const setAdminNumber = async (req, res) => {
  try {
    let { number, status } = req.body;

    if (status === "OFF") number = "Inactive";

    await adminCollection.doc("main").set(
      { number, status, updatedAt: Date.now() },
      { merge: true }
    );

    const io = req.app.get("io");
    io.emit("adminUpdate", { number, status, updatedAt: new Date() });

    console.log("👑 Real-time Admin Emit Sent:", number, status);

    return res.json({
      success: true,
      message: "Admin updated successfully",
      data: { number, status },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};