import { FileUp, Package, Download, BookOpen, Building2, AlertTriangle, TrendingUp, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { atividadesRecentes } from "@/data/mockData";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral das operações de conversão comercial</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Arquivos Processados" value={48} icon={FileUp} trend="+12 esta semana" trendUp />
        <StatCard title="Produtos Convertidos" value="1.060" icon={Package} trend="+342 novos" trendUp />
        <StatCard title="Exportações Mercos" value={23} icon={Download} trend="3 pendentes" />
        <StatCard title="Catálogos Gerados" value={15} icon={BookOpen} trend="+4 este mês" trendUp />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Fornecedores Ativos" value={4} icon={Building2} />
        <StatCard title="Pedidos Convertidos" value={31} icon={ShoppingCart} trend="+5 esta semana" trendUp />
        <StatCard title="Taxa de Aproveitamento" value="94%" icon={TrendingUp} trend="+2% vs mês anterior" trendUp />
        <StatCard title="Alertas Pendentes" value={3} icon={AlertTriangle} />
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Atividades Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Produtos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {atividadesRecentes.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium text-sm">{a.arquivo}</TableCell>
                  <TableCell className="text-sm">{a.fornecedor}</TableCell>
                  <TableCell className="text-sm">{a.tipoEntrada}</TableCell>
                  <TableCell className="text-sm">{a.data}</TableCell>
                  <TableCell className="text-sm">{a.qtdProdutos}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-xs text-primary">Ver detalhes</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
