import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AppProvider } from "@/context/AppContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ConversaoProdutos from "./pages/ConversaoProdutos";
import BasePadronizada from "./pages/BasePadronizada";
import DescontosCatalogos from "./pages/DescontosCatalogos";
import ExportacoesMercos from "./pages/ExportacoesMercos";
import ConversaoPedidos from "./pages/ConversaoPedidos";
import Fornecedores from "./pages/Fornecedores";
import RegrasMapeamento from "./pages/RegrasMapeamento";
import Historico from "./pages/Historico";
import Configuracoes from "./pages/Configuracoes";
import FeatureFlags from "./pages/admin/FeatureFlags";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/conversao" element={<ConversaoProdutos />} />
              <Route path="/base" element={<BasePadronizada />} />
              <Route path="/descontos" element={<DescontosCatalogos />} />
              <Route path="/exportacoes" element={<ExportacoesMercos />} />
              <Route path="/pedidos" element={<ConversaoPedidos />} />
              <Route path="/fornecedores" element={<Fornecedores />} />
              <Route path="/regras" element={<RegrasMapeamento />} />
              <Route path="/historico" element={<Historico />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/admin/feature-flags" element={<FeatureFlags />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
