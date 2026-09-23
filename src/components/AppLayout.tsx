import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { ConversoesEmAndamento } from "@/components/ConversoesEmAndamento";

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
            </div>
            <div className="flex items-center gap-2">
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
        {/* Some sozinho quando nada está convertendo. Fica FORA do <main>
            porque o `key={location.pathname}` ali remonta o conteúdo a cada
            navegação, e este aviso precisa justamente atravessar as telas. */}
        <ConversoesEmAndamento />
      </div>
    </SidebarProvider>
  );
}
