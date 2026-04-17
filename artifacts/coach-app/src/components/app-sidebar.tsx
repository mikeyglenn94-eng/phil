import { Link, useLocation } from "wouter";
import { Users, Eye, BookOpen, LogOut, ShieldCheck, UsersRound, LayoutDashboard } from "lucide-react";
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
import { useAuth } from "@/contexts/auth-context";

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout, hasRole } = useAuth();

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "ME";

  return (
    <Sidebar className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4 pt-6">
        <div className="flex items-center gap-3 px-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-black text-2xl leading-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>M</span>
          </div>
          <p className="text-xs text-sidebar-foreground/50 font-medium">Coach Dashboard</p>
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
                <Link href="/dashboard">
                  <SidebarMenuButton
                    isActive={location === "/dashboard"}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/clients">
                  <SidebarMenuButton
                    isActive={location === "/coach" || location === "/" || location.startsWith("/clients")}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <Users className="w-4 h-4" />
                    <span>Clients</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/teams">
                  <SidebarMenuButton
                    isActive={location.startsWith("/teams")}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <UsersRound className="w-4 h-4" />
                    <span>Teams</span>
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
              {hasRole("admin") && (
                <SidebarMenuItem>
                  <Link href="/admin">
                    <SidebarMenuButton
                      isActive={location === "/admin"}
                      className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Admin Console</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 px-2 py-3 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/50">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            {initials}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user?.email ?? "Coach Mode"}
            </p>
            <p className="text-xs text-sidebar-foreground/50 truncate capitalize">
              {user?.roles?.join(", ") ?? "Local Workspace"}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground/80 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
