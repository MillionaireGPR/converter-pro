import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function AppLayout() {
  const location = useLocation();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4 sm:px-6 shrink-0 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="hidden sm:flex relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  className="pl-9 h-8 w-56 text-sm bg-muted/50 border-0 focus-visible:ring-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-destructive ring-2 ring-card" />
              </button>
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shadow-sm">
                NR
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8" key={location.pathname}>
            <div className="page-enter max-w-[1400px] mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
