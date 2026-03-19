import { FileUp, Package, Download, BookOpen, Building2, AlertTriangle, TrendingUp, ShoppingCart, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { atividadesRecentes, chartDataMensal, chartDataFornecedor } from "@/data/mockData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral das operações de conversão comercial</p>
        </div>
        <Button className="gradient-primary text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/conversao')}>
          <FileUp className="h-4 w-4 mr-2" /> Novo Upload
        </Button>
      </div>

      {/* KPIs Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Arquivos Processados" value={48} icon={FileUp} trend="+12 esta semana" trendUp accent />
        <StatCard title="Produtos Convertidos" value="1.060" icon={Package} trend="+342 novos" trendUp />
        <StatCard title="Exportações Mercos" value={23} icon={Download} trend="3 pendentes" />
        <StatCard title="Catálogos Gerados" value={15} icon={BookOpen} trend="+4 este mês" trendUp />
      </div>

      {/* KPIs Row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Fornecedores Ativos" value={4} icon={Building2} />
        <StatCard title="Pedidos Convertidos" value={31} icon={ShoppingCart} trend="+5 esta semana" trendUp />
        <StatCard title="Taxa de Aproveitamento" value="94%" icon={TrendingUp} trend="+2% vs mês anterior" trendUp accent />
        <StatCard title="Alertas Pendentes" value={3} icon={AlertTriangle} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Evolução Mensal</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartDataMensal} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: 'hsl(220, 10%, 46%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'hsl(220, 10%, 46%)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(0, 0%, 100%)',
                    border: '1px solid hsl(220, 13%, 91%)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px hsl(0 0% 0% / 0.08)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="produtos" name="Produtos" fill="hsl(262, 60%, 50%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="exportacoes" name="Exportações" fill="hsl(262, 70%, 75%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Produtos por Fornecedor</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={chartDataFornecedor}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="produtos"
                >
                  {chartDataFornecedor.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'hsl(0, 0%, 100%)',
                    border: '1px solid hsl(220, 13%, 91%)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {chartDataFornecedor.map((f) => (
                <div key={f.nome} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.fill }} />
                    <span className="text-muted-foreground">{f.nome}</span>
                  </div>
                  <span className="font-semibold text-foreground">{f.produtos}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activities */}
      <Card className="shadow-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Atividades Recentes</CardTitle>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate('/historico')}>
            Ver tudo <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="premium-table">
              <TableHeader>
                <TableRow className="border-b-0">
                  <TableHead className="pl-6">Arquivo</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Produtos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atividadesRecentes.map((a) => (
                  <TableRow key={a.id} className="group">
                    <TableCell className="font-medium text-sm pl-6">{a.arquivo}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.fornecedor}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.tipoEntrada}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.data}</TableCell>
                    <TableCell className="text-sm text-right font-semibold">{a.qtdProdutos}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="pr-6">
                      <Button variant="ghost" size="sm" className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        Ver detalhes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
