import { Link, useLocation } from "wouter";
import { Dumbbell, Utensils } from "lucide-react";

export function ClientSidebar() {
  const [location] = useLocation();

  const items = [
    { href: "/client", label: "Training", icon: Dumbbell },
    { href: "/client/nutrition", label: "Nutrition", icon: Utensils },
  ];

  return (
    <aside className="h-full w-[13rem] flex-shrink-0 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-4 pt-6 px-5 mb-2">
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

      <div className="p-4">
        <div className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/50">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
            MG
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-semibold text-sidebar-foreground truncate">Mikey G</p>
            <p className="text-[10px] text-sidebar-foreground/50">Client</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
