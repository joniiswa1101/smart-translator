import { Router, type IRouter } from "express";
import { createRoom2, getRoom2, getParticipantList2 } from "../room2";

const router: IRouter = Router();

// POST /api/room2 - Create a new room
router.post("/room2", (_req, res) => {
  const code = createRoom2();
  res.json({ code });
});

// GET /api/room2/:code - Get room info
router.get("/room2/:code", (req, res) => {
  const room = getRoom2(req.params.code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({
    code: room.code,
    participants: getParticipantList2(room),
    currentSpeaker: room.currentSpeaker,
    isListening: room.isListening,
    isProcessing: room.isProcessing,
    isPlaying: room.isPlaying,
  });
});

export default router;
