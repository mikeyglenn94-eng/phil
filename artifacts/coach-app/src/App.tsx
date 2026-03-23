import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import NotFound from "@/pages/not-found";
import Home from "./pages/home";
import SessionEditor from "./pages/session-editor";
import { AppSidebar } from "./components/app-sidebar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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
            {/* Session editor is full-screen (no sidebar) */}
            <Route path="/programmes/:programmeId/sessions/:sessionId" component={SessionEditor} />

            {/* Calendar home + all other routes get sidebar layout */}
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
