import { Link, useLocation } from "wouter";
import { Dumbbell, Utensils, RefreshCw, X } from "lucide-react";
import { useClientContext } from "@/contexts/client-context";

interface ClientSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function ClientSidebar({ open, onClose }: ClientSidebarProps) {
  const [location] = useLocation();
  const { client, clearClient } = useClientContext();

  const initials = client
    ? client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const items = [
    { href: "/client", label: "Training", icon: Dumbbell },
    { href: "/client/nutrition", label: "Nutrition", icon: Utensils },
  ];

  const sidebarContent = (
    <aside className="h-full w-[13rem] flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
      {/* Logo + close button (mobile only) */}
      <div className="px-5 pt-6 pb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/20 p-1.5 rounded-lg">
            <Dumbbell className="w-5 h-5 text-primary" />
          </div>
          <div>
            <img src="/logo.png" alt="Logo" className="h-9 w-auto" />
            <p className="text-[10px] text-sidebar-foreground/50 font-medium mt-0.5">Client Portal</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Client identity card */}
      {client && (
        <div className="px-3 pb-3">
          <button
            onClick={() => { clearClient(); onClose(); }}
            title="Switch account"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors group text-left"
          >
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">{client.name}</p>
              <p className="text-[10px] text-sidebar-foreground/50">Tap to switch</p>
            </div>
            <RefreshCw className="w-3.5 h-3.5 text-sidebar-foreground/30 group-hover:text-primary transition-colors flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 px-3 space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/client"
            ? location === "/client" || location === "/client/"
            : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <button
                onClick={onClose}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            </Link>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <>
      {/* Desktop: always-visible left rail */}
      <div className="hidden md:flex h-full border-r">
        {sidebarContent}
      </div>

      {/* Mobile: slide-in drawer with backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Drawer */}
          <div className="relative z-10 h-full border-r shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
