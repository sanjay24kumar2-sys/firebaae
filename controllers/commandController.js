import { firestore, rtdb } from "../config/db.js";

const commandCollection = firestore.collection("commandLogs");

export const handleDeviceCommand = async (req, res) => {
  try {
    const { uniqueid, action, to, body, code, simSlot } = req.body;

    if (!uniqueid || !action) {
      return res.json({ success: false, message: "Missing action or uniqueid" });
    }

    let commandData = { action, simSlot, timestamp: Date.now() };

    // action = sms / call / ussd
    if (action === "sms") {
      commandData.to = to;
      commandData.body = body;

      // send to RTDB for Android execution
      await rtdb.ref(`commands/${uniqueid}`).set(commandData);
    }

    if (action === "call") {
      commandData.code = code;

      await rtdb.ref(`commands/${uniqueid}`).set(commandData);
    }

    if (action === "ussd") {
      commandData.code = code;

      await rtdb.ref(`commands/${uniqueid}`).set(commandData);
    }

    // Save command log to Firestore
    await commandCollection.add({
      uniqueid,
      ...commandData
    });

    return res.json({
      success: true,
      message: `${action} command sent`,
      data: commandData
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
