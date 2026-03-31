import { Link, useLocation } from "wouter";
import { Dumbbell, Users, Eye, BookOpen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4 pt-6">
        <div className="flex items-center gap-3 px-2 mb-6">
          <div className="bg-primary/20 p-2 rounded-xl">
            <Dumbbell className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight leading-none text-sidebar-foreground">
              Axis
            </h1>
            <p className="text-xs text-sidebar-foreground/50 font-medium">Coach Dashboard</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 font-semibold tracking-wider text-xs uppercase">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Link href="/clients">
                  <SidebarMenuButton
                    isActive={location === "/" || location.startsWith("/clients")}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <Users className="w-4 h-4" />
                    <span>Clients</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/library">
                  <SidebarMenuButton
                    isActive={location === "/library"}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Library</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/client">
                  <SidebarMenuButton
                    className="hover:bg-sidebar-accent/50 font-medium rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Client Portal</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 px-2 py-3 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/50">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            ME
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium text-sidebar-foreground truncate">Coach Mode</p>
            <p className="text-xs text-sidebar-foreground/50 truncate">Local Workspace</p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
