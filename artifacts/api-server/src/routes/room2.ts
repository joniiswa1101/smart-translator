import { Router, type IRouter } from "express";
import { createRoom2, getRoom2, getParticipantList2 } from "../room2";

const router: IRouter = Router();

// POST /api/room2 - Create a new room
// Body: { glossaryId?: string } for custom company glossary
router.post("/room2", (req, res) => {
  const glossaryId = req.body?.glossaryId;
  const code = createRoom2(glossaryId);
  res.json({ code, glossaryId: glossaryId || null });
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
    createdAt: room.createdAt,
  });
});

export default router;
