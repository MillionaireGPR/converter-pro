import {
  LayoutDashboard, FileUp, Database, Tag, Download, ArrowRightLeft,
  Building2, Settings as SettingsIcon, History, LogOut, Scissors, Users,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import logo from "@/assets/logo-nunes.png";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Conversão de Produtos", url: "/conversao", icon: FileUp },
  { title: "Base Padronizada", url: "/base", icon: Database },
  { title: "Descontos e Catálogos", url: "/descontos", icon: Tag },
  { title: "Exportações Mercos", url: "/exportacoes", icon: Download },
  { title: "Conversão de Pedidos", url: "/pedidos", icon: ArrowRightLeft },
  { title: "Cortar PDF", url: "/cortar-pdf", icon: Scissors },
  { title: "Fornecedores", url: "/fornecedores", icon: Building2 },
  // "Regras de Mapeamento" ESCONDIDO do menu até ser conectado ao supplierRules
  // real (hoje cria regras em paralelo no banco que o engine ignora). A página
  // continua disponível na rota /regras se precisar acessar diretamente.
  { title: "Histórico", url: "/historico", icon: History },
  { title: "Usuários", url: "/usuarios", icon: Users, adminOnly: true },
  { title: "Configurações", url: "/configuracoes", icon: SettingsIcon },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, isAdmin } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const itensVisiveis = menuItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <Sidebar collapsible="icon" className="gradient-sidebar border-r-0">
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <img src={logo} alt="Nunes Representações" className="w-10 h-10 rounded-full" />
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-sidebar-primary-foreground">Central de Conversão</span>
            <span className="text-[10px] text-sidebar-foreground/60">Nunes Representações</span>
          </div>
        )}
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {itensVisiveis.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors text-sm"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-semibold"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors text-sm w-full">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
