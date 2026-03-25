import { Loader2, Dumbbell } from "lucide-react";
import { useListClients } from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { useClientContext } from "@/contexts/client-context";

export default function ClientPicker() {
  const { data: clients, isLoading } = useListClients();
  const { selectClient } = useClientContext();

  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="bg-primary/15 p-2.5 rounded-2xl">
            <Dumbbell className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl leading-none">
              Coach<span className="text-primary">.ai</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Client Portal</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-center mb-1">Who are you?</h2>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Select your name to access your training and nutrition
        </p>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
          </div>
        ) : !clients?.length ? (
          <div className="text-center py-10 text-muted-foreground">
            <p className="text-sm">No clients set up yet.</p>
            <p className="text-xs mt-1">Ask your coach to add your name.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {clients.map((c: Client) => (
              <button
                key={c.id}
                onClick={() => selectClient(c)}
                className="w-full flex items-center gap-4 bg-card border rounded-2xl px-5 py-4 text-left hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm transition-all group active:scale-[0.99]"
              >
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  {c.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <span className="font-semibold text-base">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
