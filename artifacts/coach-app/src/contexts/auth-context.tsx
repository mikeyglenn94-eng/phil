import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Role = "athlete" | "coach" | "admin";

export interface AuthUser {
  id: number;
  email: string;
  roles: Role[];
  clientId: number | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ user: AuthUser; roles: Role[] }>;
  loginWithToken: (token: string, user: AuthUser) => void;
  logout: () => void;
  hasRole: (role: Role) => boolean;
  primaryRole: () => Role | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "axis_auth_token";
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, options: RequestInit = {}, token?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  return res;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const setAuth = useCallback((token: string, user: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    setState({ user, token, isLoading: false, isAuthenticated: true });
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }
    apiFetch("/auth/me", {}, stored).then(async r => {
      if (r.ok) {
        const user: AuthUser = await r.json();
        setState({ user, token: stored, isLoading: false, isAuthenticated: true });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setState(s => ({ ...s, isLoading: false }));
      }
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      setState(s => ({ ...s, isLoading: false }));
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    setAuth(data.token, data.user);
    return data.user as AuthUser;
  }, [setAuth]);

  const logout = useCallback(() => {
    apiFetch("/auth/logout", { method: "POST" }, state.token).catch(() => {});
    clearAuth();
  }, [clearAuth, state.token]);

  const hasRole = useCallback((role: Role) => {
    return state.user?.roles.includes(role) ?? false;
  }, [state.user]);

  const primaryRole = useCallback((): Role | null => {
    if (!state.user) return null;
    if (state.user.roles.includes("admin")) return "admin";
    if (state.user.roles.includes("coach")) return "coach";
    if (state.user.roles.includes("athlete")) return "athlete";
    return null;
  }, [state.user]);

  const loginWithToken = useCallback((token: string, user: AuthUser) => {
    setAuth(token, user);
  }, [setAuth]);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithToken, logout, hasRole, primaryRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { apiFetch };
