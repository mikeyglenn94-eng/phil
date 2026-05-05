// Public surface of @workspace/generation-flow.

export { MG_PROGRAMMING_PHILOSOPHY } from "./philosophy.js";

// Programme flow
export {
  startProgrammeFlow,
  advanceProgrammeFlow,
  isProgrammeFlowComplete,
  withAssistantMessageProgramme,
  previewReady,
  generatePreview,
  generate as generateProgramme,
  currentSlot as currentProgrammeSlot,
  type ProgrammeFlowState,
} from "./programme-flow.js";

// Session flow
export {
  startSessionFlow,
  advanceSessionFlow,
  isSessionFlowComplete,
  withAssistantMessageSession,
  generate as generateSession,
  currentSlot as currentSessionSlot,
  type SessionFlowState,
} from "./session-flow.js";

// Modification flow
export {
  startModificationFlow,
  advanceModificationFlow,
  withAssistantMessageModification,
  buildSwapChoiceSets,
  generateSwapOptions,
  recordSwapDecision,
  isModificationFlowComplete,
  generate as generateModifiedProgramme,
  type ModificationFlowState,
} from "./modification-flow.js";

// Progression flow
export {
  startProgressionFlow,
  advanceProgressionFlow,
  isProgressionFlowComplete,
  withAssistantMessageProgression,
  generate as generateProgression,
  currentSlot as currentProgressionSlot,
  computeStyleOptions as computeProgressionStyleOptions,
  type ProgressionFlowState,
  type ProgressionStyleOption,
} from "./progression-flow.js";

// Question writer + slot definitions for the route layer / UI
export { writeQuestion } from "./question-writer.js";
export {
  getSlotList,
  nextUnfilledSlot,
  PROGRAMME_SLOTS,
  SESSION_SLOTS,
  MODIFICATION_SLOTS,
  PROGRESSION_SLOTS,
} from "./types.js";

export type {
  FlowType,
  FlowState,
  FlowMessage,
  SlotDef,
  SlotKind,
  SlotOption,
  SlotValue,
  SlotValues,
  GeneratedExercise,
  GeneratedProgramme,
  GeneratedProgrammeSession,
  GeneratedSession,
  ProgrammeFlowContext,
  SessionFlowContext,
  ModificationFlowContext,
  AffectedExerciseRef,
  SwapOption,
  SwapChoiceSet,
  SwapDecision,
  ModifiedProgramme,
  ProgressionFlowContext,
  ProgressionSourceSession,
  ProgressedSession,
  ProgressedBlock,
} from "./types.js";
