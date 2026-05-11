import { FileUp, Package, Download, BookOpen, Building2, AlertTriangle, TrendingUp, ShoppingCart, ArrowRight, Upload, Wrench, FileCheck, Rocket, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp } from "@/context/AppContext";
import { useProdutos } from "@/context/ProdutosContext";
import { useFornecedores } from "@/context/FornecedoresContext";
import { useHistorico } from "@/context/HistoricoContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { dashboard } = useApp();
  const { produtosPadronizados } = useProdutos();
  const { fornecedores } = useFornecedores();
  const { historico } = useHistorico();

  const chartDataFornecedor = useMemo(() => {
    const fills = ['hsl(262, 60%, 50%)', 'hsl(262, 70%, 65%)', 'hsl(262, 40%, 75%)', 'hsl(262, 30%, 82%)', 'hsl(220, 14%, 85%)'];
    const map = new Map<string, number>();
    produtosPadronizados.forEach(p => map.set(p.fornecedor, (map.get(p.fornecedor) || 0) + 1));
    return Array.from(map.entries()).map(([nome, count], i) => ({ nome, produtos: count, fill: fills[i % fills.length] }));
  }, [produtosPadronizados]);

  const recentHistorico = historico.slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral das operações de conversão comercial</p>
        </div>
        <Button className="gradient-primary text-primary-foreground font-semibold shadow-sm" onClick={() => navigate('/conversao')}>
          <FileUp className="h-4 w-4 mr-2" /> Novo Upload
        </Button>
      </div>

      {/* Mini Tutorial - Passo a Passo */}
      <Card className="shadow-card border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Como Usar o Converter-Pro em 4 Passos</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Passo 1 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-card hover:bg-muted/30 transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">1</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <Upload className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Envie</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Clique em "Novo Upload" e envie a planilha do fornecedor com os produtos.
                </p>
              </div>
            </div>

            {/* Passo 2 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-card hover:bg-muted/30 transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">2</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <Wrench className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Ajuste</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Vá em "Base Padronizada" e corrija códigos, preços ou dados que faltam.
                </p>
              </div>
            </div>

            {/* Passo 3 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-card hover:bg-muted/30 transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">3</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <FileCheck className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Verifique</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Em "Exportações Mercos" confira se tudo está certo antes de gerar o arquivo.
                </p>
              </div>
            </div>

            {/* Passo 4 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-card hover:bg-muted/30 transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">4</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <Rocket className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Pronto!</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Baixe a planilha pronta para o Mercos e importe no sistema. Sucesso!
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Arquivos Processados" value={dashboard.arquivosProcessados} icon={FileUp} trend={dashboard.arquivosProcessados > 0 ? `${dashboard.arquivosProcessados} processado(s)` : "Nenhum ainda"} trendUp={dashboard.arquivosProcessados > 0} accent />
        <StatCard title="Produtos Convertidos" value={dashboard.produtosConvertidos} icon={Package} trend={dashboard.produtosConvertidos > 0 ? `${dashboard.produtosConvertidos} na base` : "Nenhum ainda"} trendUp={dashboard.produtosConvertidos > 0} />
        <StatCard title="Exportações Mercos" value={dashboard.exportacoesMercosCount} icon={Download} trend={dashboard.exportacoesMercosCount > 0 ? `${dashboard.exportacoesMercosCount} gerada(s)` : "Nenhuma ainda"} />
        <StatCard title="Catálogos Gerados" value={dashboard.catalogosGeradosCount} icon={BookOpen} trend={dashboard.catalogosGeradosCount > 0 ? `${dashboard.catalogosGeradosCount} catálogo(s)` : "Nenhum ainda"} trendUp={dashboard.catalogosGeradosCount > 0} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Fornecedores Ativos" value={dashboard.fornecedoresAtivos} icon={Building2} />
        <StatCard title="Pedidos Convertidos" value={dashboard.pedidosConvertidosCount} icon={ShoppingCart} trend={dashboard.pedidosConvertidosCount > 0 ? `${dashboard.pedidosConvertidosCount} pedido(s)` : "Nenhum ainda"} trendUp={dashboard.pedidosConvertidosCount > 0} />
        <StatCard title="Taxa de Aproveitamento" value={`${dashboard.taxaAproveitamento}%`} icon={TrendingUp} accent />
        <StatCard title="Alertas Pendentes" value={dashboard.alertasPendentes} icon={AlertTriangle} />
      </div>

      {chartDataFornecedor.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Produtos por Fornecedor</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartDataFornecedor} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" vertical={false} />
                  <XAxis dataKey="nome" tick={{ fontSize: 12, fill: 'hsl(220, 10%, 46%)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: 'hsl(220, 10%, 46%)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(0, 0%, 100%)', border: '1px solid hsl(220, 13%, 91%)', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="produtos" name="Produtos" fill="hsl(262, 60%, 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Distribuição</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={chartDataFornecedor} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="produtos">
                    {chartDataFornecedor.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(0, 0%, 100%)', border: '1px solid hsl(220, 13%, 91%)', borderRadius: '8px', fontSize: '12px' }} />
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
      )}

      <Card className="shadow-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Atividades Recentes</CardTitle>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate('/historico')}>
            Ver tudo <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentHistorico.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma atividade registrada ainda. Processe um arquivo para começar.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="premium-table">
                <TableHeader>
                  <TableRow className="border-b-0">
                    <TableHead className="pl-6">Arquivo</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentHistorico.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium text-sm pl-6">{h.arquivo}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.fornecedor}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.tipoConversao}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.data}</TableCell>
                      <TableCell className="text-sm text-right font-semibold">{h.qtdItens}</TableCell>
                      <TableCell><StatusBadge status={h.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
