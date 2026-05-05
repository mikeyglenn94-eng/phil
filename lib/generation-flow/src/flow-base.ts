import { parseSlots } from "./parser.js";
import {
  getSlotList,
  nextUnfilledSlot,
  type FlowState,
  type FlowType,
  type SlotDef,
  type SlotValues,
} from "./types.js";

/** Initialise an empty FlowState for the given type. */
export function startFlow<TContext>(
  type: FlowType,
  context: TContext,
): FlowState<TContext> {
  const defs = getSlotList(type);
  const slots: SlotValues = {};
  for (const def of defs) slots[def.name] = null;

  const first = nextUnfilledSlot(slots, defs);

  return {
    type,
    slots,
    currentSlot: first?.name ?? null,
    history: [],
    context,
    previewGenerated: false,
    lastParseFailure: null,
  };
}

/** Returns true only when every applicable slot has a non-null value. */
export function isComplete<T>(state: FlowState<T>): boolean {
  const defs = getSlotList(state.type);
  for (const def of defs) {
    if (def.applies && !def.applies(state.slots)) continue;
    if (state.slots[def.name] == null) return false;
  }
  return true;
}

/** Advance the flow by parsing a user message. Returns updated state. */
export async function advanceFlow<T>(
  state: FlowState<T>,
  userMessage: string,
): Promise<FlowState<T>> {
  const defs = getSlotList(state.type);
  const candidateSlots = candidateSlotsFor(state, defs);

  const parsed = await parseSlots({ userMessage, candidateSlots });

  const slots: SlotValues = { ...state.slots };
  for (const def of candidateSlots) {
    const v = parsed.extracted[def.name];
    if (v !== undefined && v !== null) slots[def.name] = v;
  }

  const next: FlowState<T> = {
    ...state,
    slots,
    history: [...state.history, { role: "user", content: userMessage }],
    lastParseFailure: parsed.failures[state.currentSlot ?? ""] ?? null,
  };

  next.currentSlot = nextUnfilledSlot(slots, defs)?.name ?? null;
  return next;
}

/** Return the slot definitions that the parser is allowed to fill on this turn:
 *  the current slot plus any later unfilled applicable slots. */
function candidateSlotsFor<T>(
  state: FlowState<T>,
  defs: SlotDef[],
): SlotDef[] {
  return defs.filter((def) => {
    if (def.applies && !def.applies(state.slots)) return false;
    return state.slots[def.name] == null;
  });
}

/** Convenience: append an assistant message to history. */
export function withAssistantMessage<T>(
  state: FlowState<T>,
  content: string,
): FlowState<T> {
  return {
    ...state,
    history: [...state.history, { role: "assistant", content }],
  };
}
