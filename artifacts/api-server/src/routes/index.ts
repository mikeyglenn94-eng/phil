import { Router, type IRouter } from "express";
import healthRouter from "./health";
import programmesRouter from "./programmes";
import parseRouter from "./parse";
import clientsRouter from "./clients";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programmesRouter);
router.use(parseRouter);
router.use(clientsRouter);

export default router;
