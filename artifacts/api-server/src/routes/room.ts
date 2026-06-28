import { Router, type IRouter } from "express";
import { createRoom, getRoom, getParticipantList } from "../room";

const router: IRouter = Router();

// POST /api/room - Create a new room
// Returns code (share with all participants) and trainerToken (share only with trainer).
router.post("/room", (_req, res) => {
  const { code, trainerToken } = createRoom();
  res.json({ code, trainerToken });
});

// GET /api/room/:code - Get room info
router.get("/room/:code", (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({
    code: room.code,
    participants: getParticipantList(room),
    currentSpeaker: room.currentSpeaker,
    isListening: room.isListening,
    isProcessing: room.isProcessing,
    isPlaying: room.isPlaying,
    trainerMode: room.trainerMode,
  });
});

export default router;
