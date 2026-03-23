import { Router, type IRouter } from "express";
import healthRouter from "./health";
import programmesRouter from "./programmes";
import parseRouter from "./parse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programmesRouter);
router.use(parseRouter);

export default router;
