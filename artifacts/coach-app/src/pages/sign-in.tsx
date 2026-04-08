import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RoleTab = "athlete" | "coach";
type AuthMode = "signin" | "create";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function SignIn() {
  const { login, isAuthenticated, primaryRole, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [roleTab, setRoleTab] = useState<RoleTab>("athlete");

  // Sign in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Create account state
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cConfirm, setCConfirm] = useState("");
  const [cError, setCError] = useState("");
  const [cLoading, setCLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const role = primaryRole();
      if (role === "admin") setLocation("/admin");
      else if (role === "coach") setLocation("/coach");
      else setLocation("/client");
    }
  }, [isAuthenticated, isLoading, primaryRole, setLocation]);

  const switchMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setError("");
    setCError("");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      const roles = user.roles;
      if (roles.includes("admin")) setLocation("/admin");
      else if (roles.includes("coach")) setLocation("/coach");
      else setLocation("/client");
    } catch (err: any) {
      setError(err.message || "Sign in failed. Check your email and password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCError("");
    if (cPassword !== cConfirm) { setCError("Passwords do not match"); return; }
    if (cPassword.length < 8) { setCError("Password must be at least 8 characters"); return; }
    setCLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cEmail.trim(), password: cPassword, role: roleTab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Account creation failed");
      localStorage.setItem("axis_auth_token", data.token);
      const roles: string[] = data.user?.roles ?? [];
      if (roles.includes("admin")) setLocation("/admin");
      else if (roles.includes("coach")) setLocation("/coach");
      else setLocation("/client");
    } catch (err: any) {
      setCError(err.message);
    } finally {
      setCLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white mb-5">
            <span className="text-[#0a0a0a] font-bold text-2xl tracking-tight">M</span>
          </div>
          <h1 className="text-white text-2xl font-semibold tracking-tight">MG Coaching</h1>
        </div>

        {/* Sign in / Create account toggle */}
        <div className="flex rounded-xl bg-white/5 p-1 mb-7 border border-white/10">
          {(["signin", "create"] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                authMode === m
                  ? "bg-white text-[#0a0a0a] shadow-sm"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {/* Role selector */}
        <div className="flex rounded-xl bg-white/5 p-1 mb-7 border border-white/10">
          {(["athlete", "coach"] as const).map(r => (
            <button
              key={r}
              onClick={() => setRoleTab(r)}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all capitalize ${
                roleTab === r
                  ? "bg-white/15 text-white"
                  : "text-white/30 hover:text-white/50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Sign in form */}
        {authMode === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-white/60 text-xs uppercase tracking-wider">Email</Label>
              <Input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-11 rounded-xl focus:border-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-white/60 text-xs uppercase tracking-wider">Password</Label>
                <button type="button" className="text-white/30 text-xs hover:text-white/60 transition-colors">
                  Forgot password?
                </button>
              </div>
              <Input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="current-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-11 rounded-xl focus:border-white/30"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button
              type="submit" disabled={submitting}
              className="w-full h-11 rounded-xl bg-white text-[#0a0a0a] font-semibold hover:bg-white/90 mt-2"
            >
              {submitting ? "Signing in…" : `Sign in as ${roleTab === "athlete" ? "Athlete" : "Coach"}`}
            </Button>
            <p className="text-center text-white/25 text-xs pt-1">
              No account?{" "}
              <button type="button" onClick={() => switchMode("create")} className="text-white/50 hover:text-white/80 underline underline-offset-2 transition-colors">
                Create one
              </button>
            </p>
          </form>
        )}

        {/* Create account form */}
        {authMode === "create" && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-white/60 text-xs uppercase tracking-wider">Email</Label>
              <Input
                type="email" value={cEmail} onChange={e => setCEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-11 rounded-xl focus:border-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/60 text-xs uppercase tracking-wider">Password</Label>
              <Input
                type="password" value={cPassword} onChange={e => setCPassword(e.target.value)}
                placeholder="Min 8 characters" required autoComplete="new-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-11 rounded-xl focus:border-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/60 text-xs uppercase tracking-wider">Confirm password</Label>
              <Input
                type="password" value={cConfirm} onChange={e => setCConfirm(e.target.value)}
                placeholder="Repeat password" required autoComplete="new-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-11 rounded-xl focus:border-white/30"
              />
            </div>
            {cError && <p className="text-red-400 text-sm">{cError}</p>}
            <Button
              type="submit" disabled={cLoading}
              className="w-full h-11 rounded-xl bg-white text-[#0a0a0a] font-semibold hover:bg-white/90 mt-2"
            >
              {cLoading ? "Creating account…" : `Create ${roleTab === "athlete" ? "Athlete" : "Coach"} account`}
            </Button>
            <p className="text-center text-white/25 text-xs pt-1">
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")} className="text-white/50 hover:text-white/80 underline underline-offset-2 transition-colors">
                Sign in
              </button>
            </p>
          </form>
        )}

      </div>
    </div>
  );
}
