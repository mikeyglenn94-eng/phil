import { useState } from "react";
import { Loader2, Dumbbell, Eye, EyeOff, ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useListClients, useSetClientPassword, useVerifyClientPassword } from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { useClientContext } from "@/contexts/client-context";

type Screen =
  | { kind: "pick" }
  | { kind: "set-password"; client: Client }
  | { kind: "enter-password"; client: Client };

export default function ClientPicker() {
  const { data: clients, isLoading } = useListClients();
  const { selectClient } = useClientContext();

  const [screen, setScreen] = useState<Screen>({ kind: "pick" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setPasswordMutation = useSetClientPassword();
  const verifyPasswordMutation = useVerifyClientPassword();

  function handlePickClient(c: Client) {
    setPassword(""); setConfirm(""); setError(""); setShowPw(false);
    if (c.hasPassword) {
      setScreen({ kind: "enter-password", client: c });
    } else {
      setScreen({ kind: "set-password", client: c });
    }
  }

  async function handleSetPassword() {
    if (screen.kind !== "set-password") return;
    if (password.length < 4) { setError("Password must be at least 4 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    setBusy(true); setError("");
    try {
      await setPasswordMutation.mutateAsync({ clientId: screen.client.id, data: { password } });
      selectClient(screen.client);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  async function handleVerifyPassword() {
    if (screen.kind !== "enter-password") return;
    setBusy(true); setError("");
    try {
      const result = await verifyPasswordMutation.mutateAsync({ clientId: screen.client.id, data: { password } });
      if (result.success) {
        selectClient(screen.client);
      } else {
        setError("Incorrect password. Please try again.");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  const initials = (c: Client) =>
    c.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const Logo = () => (
    <div className="flex flex-col items-center mb-10">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-2 shadow-lg">
        <span className="text-white font-black text-4xl leading-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>M</span>
      </div>
      <p className="text-xs text-muted-foreground">Client Portal</p>
    </div>
  );

  /* ── Set Password screen ── */
  if (screen.kind === "set-password") {
    const c = screen.client;
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm">
          <Logo />

          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setScreen({ kind: "pick" })} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{initials(c)}</div>
              <span className="font-semibold">{c.name}</span>
            </div>
          </div>

          <div className="bg-primary/5 border border-primary/15 rounded-2xl px-5 py-4 mb-6 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Create your password</p>
              <p className="text-xs text-muted-foreground mt-0.5">You'll use this every time you log in.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                placeholder="New password (min. 4 characters)"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSetPassword()}
                className="pr-10"
                autoFocus
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Input
              type={showPw ? "text" : "password"}
              placeholder="Confirm password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleSetPassword()}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={handleSetPassword} disabled={busy || !password || !confirm} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Set Password & Enter
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Enter Password screen ── */
  if (screen.kind === "enter-password") {
    const c = screen.client;
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm">
          <Logo />

          <div className="flex items-center gap-3 mb-8">
            <button onClick={() => setScreen({ kind: "pick" })} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{initials(c)}</div>
              <span className="font-semibold">{c.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-bold">Enter your password</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6">Welcome back, {c.name.split(" ")[0]}.</p>

          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleVerifyPassword()}
                className="pr-10"
                autoFocus
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button onClick={handleVerifyPassword} disabled={busy || !password} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Continue
            </Button>
            <p className="text-center text-xs text-muted-foreground pt-1">
              Forgotten your password?{" "}
              <a
                href="https://wa.me/447928712251"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Message your coach
              </a>{" "}
              to get it reset.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Client picker screen ── */
  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <Logo />

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
                onClick={() => handlePickClient(c)}
                className="w-full flex items-center gap-4 bg-card border rounded-2xl px-5 py-4 text-left hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm transition-all group active:scale-[0.99]"
              >
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  {initials(c)}
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-base">{c.name}</span>
                </div>
                {c.hasPassword && <Lock className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
