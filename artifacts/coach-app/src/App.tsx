import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import NotFound from "@/pages/not-found";
import Home from "./pages/home";
import Builder from "./pages/builder";
import { AppSidebar } from "./components/app-sidebar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/programmes/new">
        {() => <Builder isNew={true} />}
      </Route>
      <Route path="/programmes/:id" component={Builder} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          {/* We only render sidebar on non-builder routes for focus, or always. Let's render always but hide sidebar trigger in builder. */}
          <Switch>
            {/* Builder has its own full screen layout, so we don't wrap it in Sidebar layout */}
            <Route path="/programmes/new">
              {() => <Builder isNew={true} />}
            </Route>
            <Route path="/programmes/:id" component={Builder} />
            
            {/* Other routes get the sidebar */}
            <Route path="*">
              <SidebarProvider style={style as React.CSSProperties}>
                <div className="flex h-[100dvh] w-full overflow-hidden">
                  <AppSidebar />
                  <div className="flex flex-col flex-1 relative min-w-0">
                    <header className="absolute top-4 left-4 z-50 md:hidden">
                      <SidebarTrigger className="bg-background shadow-md border rounded-lg" data-testid="button-sidebar-toggle" />
                    </header>
                    <main className="flex-1 overflow-hidden flex flex-col">
                      <Router />
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
