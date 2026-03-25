import { Link, useLocation } from "wouter";
import { LayoutDashboard, Dumbbell, FileText, Users, Eye } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { useListProgrammes } from "@workspace/api-client-react";

interface AppSidebarProps {
  onNewProgramme?: () => void;
  onSelectProgramme?: (id: number) => void;
  selectedProgrammeId?: number | null;
}

export function AppSidebar({ onNewProgramme, onSelectProgramme, selectedProgrammeId }: AppSidebarProps) {
  const [location] = useLocation();
  const { data: programmes, isLoading } = useListProgrammes();

  return (
    <Sidebar className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4 pt-6">
        <div className="flex items-center gap-3 px-2 mb-6">
          <div className="bg-primary/20 p-2 rounded-xl">
            <Dumbbell className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight leading-none text-sidebar-foreground">
              Coach<span className="text-primary">.ai</span>
            </h1>
            <p className="text-xs text-sidebar-foreground/50 font-medium">Programme Builder</p>
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
                <Link href="/">
                  <SidebarMenuButton
                    isActive={location === "/"}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Coach Calendar</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/clients">
                  <SidebarMenuButton
                    isActive={location.startsWith("/clients")}
                    className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg"
                  >
                    <Users className="w-4 h-4" />
                    <span>Clients</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/client">
                  <SidebarMenuButton
                    className="hover:bg-sidebar-accent/50 font-medium rounded-lg text-primary/80 hover:text-primary"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Client View</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-sidebar-foreground/50 font-semibold tracking-wider text-xs uppercase">
            Programmes
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {isLoading ? (
              <div className="px-4 py-3 text-sm text-sidebar-foreground/40 animate-pulse">Loading...</div>
            ) : programmes?.length === 0 ? (
              <div className="px-4 py-3 text-sm text-sidebar-foreground/40 italic">No programmes yet</div>
            ) : (
              <SidebarMenu>
                {programmes?.slice(0, 10).map((prog) => (
                  <SidebarMenuItem key={prog.id}>
                    {onSelectProgramme ? (
                      <SidebarMenuButton
                        isActive={selectedProgrammeId === prog.id}
                        className="hover:bg-sidebar-accent/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground font-medium rounded-lg cursor-pointer"
                        onClick={() => onSelectProgramme(prog.id)}
                      >
                        <FileText className="w-4 h-4 opacity-50" />
                        <span className="truncate">{prog.title || 'Untitled Programme'}</span>
                      </SidebarMenuButton>
                    ) : (
                      <Link href="/">
                        <SidebarMenuButton
                          className="hover:bg-sidebar-accent/50 font-medium rounded-lg"
                        >
                          <FileText className="w-4 h-4 opacity-50" />
                          <span className="truncate">{prog.title || 'Untitled Programme'}</span>
                        </SidebarMenuButton>
                      </Link>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
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
