import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import { useState } from "react";
import { useLocation } from "wouter";
import NotFound from "@/pages/not-found";
import Home from "./pages/home";
import SessionEditor from "./pages/session-editor";
import ClientHome from "./pages/client-home";
import ClientSession from "./pages/client-session";
import ClientNutrition from "./pages/client-nutrition";
import ClientPicker from "./pages/client-picker";
import ClientsList from "./pages/clients-list";
import ClientArea from "./pages/client-area";
import { AppSidebar } from "./components/app-sidebar";
import { ClientSidebar } from "./components/client-sidebar";
import { ClientProvider, useClientContext } from "./contexts/client-context";
import { Menu } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ClientPortalWrapper({ children }: { children: React.ReactNode }) {
  const { client } = useClientContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  if (!client) return <ClientPicker />;

  const initials = client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const pageLabel = location.startsWith("/client/nutrition") ? "Nutrition" : "Training";

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden">
      {/* Mobile top bar — hidden on md+ */}
      <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-background flex-shrink-0">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-foreground/70"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="flex-1 font-semibold text-sm text-foreground">{pageLabel}</span>
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs"
          title={client.name}
        >
          {initials}
        </button>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <ClientSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
      </div>
    </div>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            {/* Full-screen routes (no sidebar) */}
            <Route path="/programmes/:programmeId/sessions/:sessionId" component={SessionEditor} />
            <Route path="/client/programmes/:programmeId/sessions/:sessionId" component={ClientSession} />

            {/* Client routes — gated by client picker */}
            <Route path="/client/nutrition">
              <ClientProvider>
                <ClientPortalWrapper><ClientNutrition /></ClientPortalWrapper>
              </ClientProvider>
            </Route>
            <Route path="/client">
              <ClientProvider>
                <ClientPortalWrapper><ClientHome /></ClientPortalWrapper>
              </ClientProvider>
            </Route>

            {/* Coach routes — sidebar layout */}
            <Route path="*">
              <SidebarProvider style={style as React.CSSProperties}>
                <div className="flex h-[100dvh] w-full overflow-hidden">
                  <AppSidebar />
                  <div className="flex flex-col flex-1 relative min-w-0 overflow-hidden">
                    <header className="absolute top-4 left-4 z-50 md:hidden">
                      <SidebarTrigger className="bg-background shadow-md border rounded-lg" />
                    </header>
                    <main className="flex-1 overflow-hidden flex flex-col">
                      <Switch>
                        <Route path="/" component={Home} />
                        <Route path="/clients" component={ClientsList} />
                        <Route path="/clients/:clientId" component={ClientArea} />
                        <Route component={NotFound} />
                      </Switch>
                    </main>
                  </div>
                </div>
              </SidebarProvider>
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
