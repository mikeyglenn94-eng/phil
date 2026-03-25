import { Router, type IRouter } from "express";
import healthRouter from "./health";
import programmesRouter from "./programmes";
import parseRouter from "./parse";
import clientsRouter from "./clients";
import wodBrainRouter from "./wod-brain";
import runBrainRouter from "./run-brain";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programmesRouter);
router.use(parseRouter);
router.use(clientsRouter);
router.use(wodBrainRouter);
router.use(runBrainRouter);

export default router;
