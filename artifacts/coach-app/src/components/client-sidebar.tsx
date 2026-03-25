import { Link, useLocation } from "wouter";
import { Dumbbell, Utensils, RefreshCw } from "lucide-react";
import { useClientContext } from "@/contexts/client-context";

export function ClientSidebar() {
  const [location] = useLocation();
  const { client, clearClient } = useClientContext();

  const initials = client
    ? client.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const items = [
    { href: "/client", label: "Training", icon: Dumbbell },
    { href: "/client/nutrition", label: "Nutrition", icon: Utensils },
  ];

  return (
    <aside className="h-full w-[13rem] flex-shrink-0 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/20 p-1.5 rounded-lg">
            <Dumbbell className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-base leading-none text-sidebar-foreground">
              Coach<span className="text-primary">.ai</span>
            </h1>
            <p className="text-[10px] text-sidebar-foreground/50 font-medium mt-0.5">Client Portal</p>
          </div>
        </div>
      </div>

      {/* Client identity card — clickable to switch */}
      {client && (
        <div className="px-3 pb-3">
          <button
            onClick={clearClient}
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
}
