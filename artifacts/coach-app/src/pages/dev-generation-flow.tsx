/**
 * Dev playground for the generation-flow state machines.
 *
 * One page, three tabs (programme / session / modification). Each tab mounts
 * the GenerationFlowChat component. Results render in a side pane.
 *
 * Coach/admin-only. Safe to run against the real API — calls /generation-flow
 * which loads MG_PROGRAMMING_PHILOSOPHY for the generator.
 */

import { useState } from "react";
import { GenerationFlowChat } from "@/components/generation-flow-chat";

type FlowType = "programme" | "session" | "modification";

const TABS: { value: FlowType; label: string; description: string }[] = [
  {
    value: "programme",
    label: "Programme",
    description: "Walk every slot, generate a week-1 preview, then the full block.",
  },
  {
    value: "session",
    label: "Session",
    description: "Walk the slots, generate a single session.",
  },
  {
    value: "modification",
    label: "Modification",
    description: "Pick a modification type, describe it, work through swap choices.",
  },
];

export default function DevGenerationFlow() {
  const [tab, setTab] = useState<FlowType>("programme");
  const [preview, setPreview] = useState<unknown>(null);
  const [result, setResult] = useState<unknown>(null);
  const [activeKey, setActiveKey] = useState(0);

  function reset() {
    setPreview(null);
    setResult(null);
    setActiveKey((k) => k + 1);
  }

  return (
    <div className="min-h-[100dvh] bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Generation Flow — Dev Playground</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Drives lib/generation-flow via /api/generation-flow. The state machine guarantees the
            questions; the LLM only writes copy, parses, and generates.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setTab(t.value);
                reset();
              }}
              className={`text-sm px-4 py-2 rounded-full border transition-colors ${
                tab === t.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 hover:bg-muted/60 text-foreground border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={reset}
            className="text-xs px-3 py-1.5 rounded-full border bg-muted/30 hover:bg-muted/60 transition-colors"
          >
            Reset
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {TABS.find((t) => t.value === tab)?.description}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-card min-h-[400px]">
            <GenerationFlowChat
              key={`${tab}-${activeKey}`}
              type={tab}
              context={contextFor(tab)}
              onPreview={setPreview}
              onComplete={(r) => setResult(r.data)}
            />
          </div>

          <div className="rounded-2xl border bg-card p-4 min-h-[400px] overflow-auto">
            {!preview && !result ? (
              <p className="text-sm text-muted-foreground italic">
                Output appears here once Phil's done.
              </p>
            ) : null}

            {preview ? (
              <div className="mb-4">
                <h2 className="text-sm font-semibold mb-2">Preview (week 1)</h2>
                <pre className="text-[11px] bg-muted/30 rounded p-3 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
            ) : null}

            {result ? (
              <div>
                <h2 className="text-sm font-semibold mb-2">Result</h2>
                <pre className="text-[11px] bg-muted/30 rounded p-3 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function contextFor(type: FlowType): Record<string, unknown> {
  switch (type) {
    case "programme":
    case "session":
      return {};
    case "modification":
      // Modification needs at least an empty programme context. In production
      // this would be the athlete's current programme; the playground starts
      // empty so Phil's identifier picks nothing — the user would need to
      // paste real data via the network tab to fully exercise this path.
      return {
        programmeId: 0,
        programmeName: "Demo programme",
        futureSessions: [],
        equipmentList: "full commercial gym",
      };
  }
}
