import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AppProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ReactNode } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ConversaoProdutos from "./pages/ConversaoProdutos";
import BasePadronizada from "./pages/BasePadronizada";
import DescontosCatalogos from "./pages/DescontosCatalogos";
import ExportacoesMercos from "./pages/ExportacoesMercos";
import ConversaoPedidos from "./pages/ConversaoPedidos";
import CortarPdf from "./pages/CortarPdf";
import Fornecedores from "./pages/Fornecedores";
import Usuarios from "./pages/Usuarios";
import RegrasMapeamento from "./pages/RegrasMapeamento";
import Historico from "./pages/Historico";
import Configuracoes from "./pages/Configuracoes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { autenticado } = useAuth();
  if (!autenticado) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/conversao" element={<ConversaoProdutos />} />
                <Route path="/base" element={<BasePadronizada />} />
                <Route path="/descontos" element={<DescontosCatalogos />} />
                <Route path="/exportacoes" element={<ExportacoesMercos />} />
                <Route path="/pedidos" element={<ConversaoPedidos />} />
                <Route path="/cortar-pdf" element={<CortarPdf />} />
                <Route path="/fornecedores" element={<Fornecedores />} />
                <Route path="/usuarios" element={<Usuarios />} />
                <Route path="/regras" element={<RegrasMapeamento />} />
                <Route path="/historico" element={<Historico />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
