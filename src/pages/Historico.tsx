import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useApp } from "@/context/AppContext";
import { History, RotateCcw, Inbox } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const routeMap: Record<string, string> = {
  'Importação de Produtos': '/base',
  'Exportação Mercos': '/exportacoes',
  'Catálogo Gerado': '/descontos',
  'Conversão de Pedido': '/pedidos',
  'Validação de Produtos': '/base',
  'Aplicação de Desconto': '/base',
  'Exportação Excel': '/descontos',
};

export default function Historico() {
  const { historico } = useApp();
  const navigate = useNavigate();

  const handleReabrir = (op: typeof historico[0]) => {
    const route = routeMap[op.tipoConversao];
    if (route) {
      navigate(route);
      toast.info(`Navegando para ${op.tipoConversao}`);
    } else {
      toast.info("Visualização não disponível para este tipo");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Histórico</h1>
        <p className="text-sm text-muted-foreground">Registro completo de todas as operações ({historico.length})</p>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {historico.length === 0 ? (
            <div className="p-12 text-center">
              <Inbox className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-1">Nenhuma operação registrada</h3>
              <p className="text-sm text-muted-foreground">Processe arquivos, valide produtos ou gere exportações para ver o histórico.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm font-medium">{h.arquivo}</TableCell>
                    <TableCell className="text-sm">{h.fornecedor}</TableCell>
                    <TableCell className="text-sm">{h.usuario}</TableCell>
                    <TableCell className="text-sm">{h.data}</TableCell>
                    <TableCell className="text-xs">{h.tipoConversao}</TableCell>
                    <TableCell className="text-right text-sm">{h.qtdItens}</TableCell>
                    <TableCell><StatusBadge status={h.status} /></TableCell>
                    <TableCell><Button variant="ghost" size="sm" className="text-xs" onClick={() => handleReabrir(h)}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reabrir</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
