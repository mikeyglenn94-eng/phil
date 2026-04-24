import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useEffect } from "react";

import NotFound from "@/pages/not-found";
import SignIn from "@/pages/sign-in";
import AdminConsole from "@/pages/admin-console";
import SessionEditor from "./pages/session-editor";
import ClientHome from "./pages/client-home";
import ClientSession from "./pages/client-session";
import ClientsList from "./pages/clients-list";
import ClientArea from "./pages/client-area";
import CoachClientCalendar from "./pages/coach-client-calendar";
import Library from "./pages/library";
import LibraryBuilder from "./pages/library-builder";
import StrengthBlocks from "./pages/strength-blocks";
import Teams from "./pages/teams";
import TeamDetail from "./pages/team-detail";
import CoachDashboard from "./pages/coach-dashboard";
import { AppSidebar } from "./components/app-sidebar";
import { ClientProvider, useClientContext } from "./contexts/client-context";
import { AuthProvider, useAuth } from "./contexts/auth-context";
import { ChatProvider } from "./contexts/chat-context";
import ChatPage from "./pages/chat";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Redirects unauthenticated users to sign-in
function RequireAuth({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation("/");
      return;
    }
    if (roles && user && !roles.some(r => user.roles.includes(r as any))) {
      // Wrong role — redirect to their proper area
      if (user.roles.includes("admin")) setLocation("/admin");
      else if (user.roles.includes("coach")) setLocation("/dashboard");
      else setLocation("/client");
    }
  }, [isAuthenticated, isLoading, user, roles, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return null;
  if (roles && user && !roles.some(r => user.roles.includes(r as any))) return null;
  return <>{children}</>;
}

// For the athlete portal: show picker if no auth, or auto-use JWT clientId
function ClientPortalWrapper({ children }: { children: React.ReactNode }) {
  const { client, selectClient } = useClientContext();
  const { user, token, logout } = useAuth();
  const [, setLocation] = useLocation();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  // When the authenticated user has a linked clientId, ALWAYS force-select their own
  // account — this prevents a stale localStorage entry (from a coach or previous session)
  // from showing the wrong client's data to the logged-in athlete.
  const needsForceSelect = !!(user?.clientId && token && client?.id !== user.clientId);

  useEffect(() => {
    if (needsForceSelect) {
      fetch(`${BASE}/api/clients/${user!.clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => {
          if (r.ok) return r.json();
          // Client not found (e.g. stale token pointing at a deleted client) — clear session
          if (r.status === 404 || r.status === 403) {
            logout();
            setLocation("/");
          }
          return null;
        })
        .then(c => { if (c) selectClient(c); })
        .catch(() => {
          logout();
          setLocation("/");
        });
    }
  }, [user?.clientId, token]);

  // If user has no linked clientId, redirect based on role.
  // Athletes: clear the stale token and send to sign-in so the login endpoint can auto-create their client.
  // Coaches/admins: send to their dashboard.
  useEffect(() => {
    if (!user || client || needsForceSelect) return;
    if (user.clientId) return; // being resolved via needsForceSelect
    if (user.roles.includes("coach") || user.roles.includes("admin")) {
      setLocation("/clients");
    } else {
      // Athlete with a stale null-clientId token — clear session so login re-creates their client
      logout();
      setLocation("/");
    }
  }, [user?.id, client?.id, needsForceSelect]);

  // Loading state while fetching the linked client
  if (needsForceSelect) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-foreground/20 border-t-foreground/60 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      {children}
    </div>
  );
}

function CoachLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  };
  return (
    <RequireAuth roles={["coach", "admin"]}>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-[100dvh] w-full overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 relative min-w-0 overflow-hidden">
            <header className="absolute top-4 left-4 z-50 md:hidden">
              <SidebarTrigger className="bg-background shadow-md border rounded-lg" />
            </header>
            <main className="flex-1 overflow-hidden flex flex-col">
              <Switch>
                <Route path="/dashboard" component={CoachDashboard} />
                <Route path="/coach" component={ClientsList} />
                <Route path="/clients" component={ClientsList} />
                <Route path="/clients/:clientId/programmes/:programmeId" component={CoachClientCalendar} />
                <Route path="/clients/:clientId" component={ClientArea} />
                <Route path="/teams/:teamId" component={TeamDetail} />
                <Route path="/teams" component={Teams} />
                <Route path="/library/builder/:programmeId" component={LibraryBuilder} />
                <Route path="/library" component={Library} />
                <Route path="/strength-blocks" component={StrengthBlocks} />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </RequireAuth>
  );
}

function SignOut() {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    logout();
    setLocation("/");
  }, []);
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ChatProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Switch>
              {/* Public */}
              <Route path="/sign-out" component={SignOut} />
              <Route path="/" component={SignIn} />

              {/* Admin */}
              <Route path="/admin">
                <RequireAuth roles={["admin"]}>
                  <AdminConsole />
                </RequireAuth>
              </Route>

              {/* Full-screen editor routes (behind coach auth) */}
              <Route path="/programmes/:programmeId/sessions/:sessionId">
                <RequireAuth roles={["coach", "admin"]}>
                  <SessionEditor />
                </RequireAuth>
              </Route>

              {/* Client session (athletes or coaches previewing) */}
              <Route path="/client/programmes/:programmeId/sessions/:sessionId" component={ClientSession} />

              {/* Athlete portal */}
              <Route path="/chat">
                <RequireAuth roles={["athlete", "coach", "admin"]}>
                  <ClientProvider>
                    <ClientPortalWrapper><ChatPage /></ClientPortalWrapper>
                  </ClientProvider>
                </RequireAuth>
              </Route>
              <Route path="/client/nutrition">
                <RequireAuth roles={["athlete", "coach", "admin"]}>
                  <ClientProvider>
                    <ClientPortalWrapper><ClientHome /></ClientPortalWrapper>
                  </ClientProvider>
                </RequireAuth>
              </Route>
              <Route path="/client">
                <RequireAuth roles={["athlete", "coach", "admin"]}>
                  <ClientProvider>
                    <ClientPortalWrapper><ClientHome /></ClientPortalWrapper>
                  </ClientProvider>
                </RequireAuth>
              </Route>

              {/* Coach area — handles /coach, /clients/*, /library/*, /strength-blocks */}
              <Route path="*" component={CoachLayout} />
            </Switch>
          </WouterRouter>
          </ChatProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
