import { Router, type IRouter } from "express";
import healthRouter from "./health";
import quizzesRouter from "./quizzes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(quizzesRouter);

export default router;
