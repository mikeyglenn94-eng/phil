import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import { useState } from "react";
import NotFound from "@/pages/not-found";
import SessionEditor from "./pages/session-editor";
import ClientHome from "./pages/client-home";
import ClientSession from "./pages/client-session";
import ClientPicker from "./pages/client-picker";
import ClientsList from "./pages/clients-list";
import ClientArea from "./pages/client-area";
import CoachClientCalendar from "./pages/coach-client-calendar";
import Library from "./pages/library";
import LibraryBuilder from "./pages/library-builder";
import StrengthBlocks from "./pages/strength-blocks";
import { AppSidebar } from "./components/app-sidebar";
import { ClientProvider, useClientContext } from "./contexts/client-context";

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
  if (!client) return <ClientPicker />;
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      {children}
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

            {/* Client portal — both /client and /client/* render the same full-feature view */}
            <Route path="/client/nutrition">
              <ClientProvider>
                <ClientPortalWrapper><ClientHome /></ClientPortalWrapper>
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
                        <Route path="/" component={ClientsList} />
                        <Route path="/clients" component={ClientsList} />
                        <Route path="/clients/:clientId/programmes/:programmeId" component={CoachClientCalendar} />
                        <Route path="/clients/:clientId" component={ClientArea} />
                        <Route path="/library/builder/:programmeId" component={LibraryBuilder} />
                        <Route path="/library" component={Library} />
                        <Route path="/strength-blocks" component={StrengthBlocks} />
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
