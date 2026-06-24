import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionRouter from "./session";
import roomRouter from "./room";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionRouter);
router.use(roomRouter);

export default router;
