import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionRouter from "./session";
import roomRouter from "./room";
import room2Router from "./room2";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionRouter);
router.use(roomRouter);
router.use(room2Router);

export default router;
