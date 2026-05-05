import { Router, type IRouter } from "express";
import {
  advanceModificationFlow,
  advanceProgrammeFlow,
  advanceSessionFlow,
  buildSwapChoiceSets,
  currentProgrammeSlot,
  currentSessionSlot,
  generateModifiedProgramme,
  generatePreview,
  generateProgramme,
  generateSession,
  getSlotList,
  isModificationFlowComplete,
  isProgrammeFlowComplete,
  isSessionFlowComplete,
  previewReady,
  recordSwapDecision,
  startModificationFlow,
  startProgrammeFlow,
  startSessionFlow,
  withAssistantMessageProgramme,
  withAssistantMessageSession,
  withAssistantMessageModification,
  writeQuestion,
  type FlowState,
  type FlowType,
  type ModificationFlowState,
  type ProgrammeFlowState,
  type SessionFlowState,
  type SlotDef,
  type SwapDecision,
} from "@workspace/generation-flow";
import { logApiCost } from "../lib/log-api-cost";

const router: IRouter = Router();

interface StartBody {
  action: "start";
  type: FlowType;
  context: Record<string, unknown>;
}

interface AdvanceBody {
  action: "advance";
  state: FlowState<unknown>;
  userMessage: string;
}

interface PreviewBody {
  action: "preview";
  state: ProgrammeFlowState;
}

interface GenerateBody {
  action: "generate";
  state: FlowState<unknown>;
}

interface SwapOptionsBody {
  action: "swap_options";
  state: ModificationFlowState;
}

interface RecordSwapBody {
  action: "record_swap";
  state: ModificationFlowState;
  exerciseName: string;
  decision: SwapDecision;
}

type FlowBody =
  | StartBody
  | AdvanceBody
  | PreviewBody
  | GenerateBody
  | SwapOptionsBody
  | RecordSwapBody;

router.post("/generation-flow", async (req, res): Promise<void> => {
  const body = req.body as FlowBody;
  if (!body || typeof body !== "object" || !("action" in body)) {
    res.status(400).json({ error: "action is required" });
    return;
  }

  try {
    switch (body.action) {
      case "start":
        await handleStart(body, req, res);
        return;
      case "advance":
        await handleAdvance(body, req, res);
        return;
      case "preview":
        await handlePreview(body, req, res);
        return;
      case "generate":
        await handleGenerate(body, req, res);
        return;
      case "swap_options":
        await handleSwapOptions(body, req, res);
        return;
      case "record_swap":
        await handleRecordSwap(body, req, res);
        return;
      default: {
        const _exhaustive: never = body;
        void _exhaustive;
        res.status(400).json({ error: "Unknown action" });
        return;
      }
    }
  } catch (err) {
    req.log.error({ err }, "generation-flow handler failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleStart(
  body: StartBody,
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  let state: FlowState<unknown>;
  switch (body.type) {
    case "programme":
      state = startProgrammeFlow(body.context as never);
      break;
    case "session":
      state = startSessionFlow(body.context as never);
      break;
    case "modification":
      state = startModificationFlow(body.context as never);
      break;
    default:
      res.status(400).json({ error: `Unknown flow type: ${String((body as { type: unknown }).type)}` });
      return;
  }

  const slotDef = currentSlotDef(state);
  const message = slotDef
    ? await writeQuestion({ slot: slotDef, history: state.history })
    : "We're ready. Tell me when to build it.";

  state = appendAssistant(state, message);
  void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:start", model: "gpt-5.2", usage: null });

  res.json({
    state,
    assistantMessage: message,
    options: slotOptions(slotDef),
  });
}

async function handleAdvance(
  body: AdvanceBody,
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  const advanced = await advanceFlowDispatch(body.state, body.userMessage);

  void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:advance", model: "gpt-5.2", usage: null });

  if (advanced.type === "programme" && previewReady(advanced as ProgrammeFlowState)) {
    res.json({
      state: advanced,
      assistantMessage: null,
      previewReady: true,
    });
    return;
  }

  if (isFlowComplete(advanced)) {
    res.json({
      state: advanced,
      assistantMessage: null,
      complete: true,
    });
    return;
  }

  const slotDef = currentSlotDef(advanced);
  const message = slotDef
    ? await writeQuestion({
        slot: slotDef,
        history: advanced.history,
        lastParseFailure: advanced.lastParseFailure,
      })
    : "";

  const stateOut = appendAssistant(advanced, message);
  res.json({
    state: stateOut,
    assistantMessage: message,
    options: slotOptions(slotDef),
  });
}

async function handlePreview(
  body: PreviewBody,
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  const preview = await generatePreview(body.state);
  const stateOut: ProgrammeFlowState = {
    ...body.state,
    previewGenerated: true,
    preview,
  };
  void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:preview", model: "gpt-5.2", usage: null });

  res.json({ state: stateOut, preview });
}

async function handleGenerate(
  body: GenerateBody,
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  switch (body.state.type) {
    case "programme": {
      const programme = await generateProgramme(body.state as ProgrammeFlowState);
      void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:generate", model: "gpt-5.2", usage: null });
      res.json({ result: programme });
      return;
    }
    case "session": {
      const session = await generateSession(body.state as SessionFlowState);
      void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:generate", model: "gpt-5.2", usage: null });
      res.json({ result: session });
      return;
    }
    case "modification": {
      const modified = await generateModifiedProgramme(body.state as ModificationFlowState);
      void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:generate", model: "gpt-5.2", usage: null });
      res.json({ result: modified });
      return;
    }
    default:
      res.status(400).json({ error: `Unknown flow type: ${String((body.state as { type: unknown }).type)}` });
      return;
  }
}

async function handleSwapOptions(
  body: SwapOptionsBody,
  req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  const sets = await buildSwapChoiceSets(body.state);
  void logApiCost({ userId: req.auth?.userId, endpoint: "generation-flow:swap-options", model: "gpt-5.2", usage: null });
  res.json({ state: body.state, swapChoiceSets: sets });
}

async function handleRecordSwap(
  body: RecordSwapBody,
  _req: Parameters<Parameters<typeof router.post>[1]>[0],
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): Promise<void> {
  const next = recordSwapDecision(body.state, body.exerciseName, body.decision);
  res.json({
    state: next,
    complete: isModificationFlowComplete(next),
  });
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function advanceFlowDispatch(
  state: FlowState<unknown>,
  userMessage: string,
): Promise<FlowState<unknown>> {
  switch (state.type) {
    case "programme":
      return advanceProgrammeFlow(state as ProgrammeFlowState, userMessage);
    case "session":
      return advanceSessionFlow(state as SessionFlowState, userMessage);
    case "modification":
      return advanceModificationFlow(state as ModificationFlowState, userMessage);
    default:
      throw new Error(`Unknown flow type: ${String(state.type)}`);
  }
}

function isFlowComplete(state: FlowState<unknown>): boolean {
  switch (state.type) {
    case "programme":
      return isProgrammeFlowComplete(state as ProgrammeFlowState);
    case "session":
      return isSessionFlowComplete(state as SessionFlowState);
    case "modification":
      return isModificationFlowComplete(state as ModificationFlowState);
    default:
      throw new Error(`Unknown flow type: ${String(state.type)}`);
  }
}

function currentSlotDef(state: FlowState<unknown>): SlotDef | null {
  const name =
    state.type === "programme"
      ? currentProgrammeSlot(state as ProgrammeFlowState)
      : state.type === "session"
        ? currentSessionSlot(state as SessionFlowState)
        : state.currentSlot;
  if (!name) return null;
  return getSlotList(state.type).find((d: SlotDef) => d.name === name) ?? null;
}

function slotOptions(slot: SlotDef | null) {
  if (!slot || !slot.options) return null;
  return {
    kind: slot.kind,
    options: slot.options,
    allowOther: slot.allowOther ?? false,
  };
}

function appendAssistant(state: FlowState<unknown>, content: string): FlowState<unknown> {
  if (!content) return state;
  switch (state.type) {
    case "programme":
      return withAssistantMessageProgramme(state as ProgrammeFlowState, content);
    case "session":
      return withAssistantMessageSession(state as SessionFlowState, content);
    case "modification":
      return withAssistantMessageModification(state as ModificationFlowState, content);
    default:
      throw new Error(`Unknown flow type: ${String(state.type)}`);
  }
}

export default router;
