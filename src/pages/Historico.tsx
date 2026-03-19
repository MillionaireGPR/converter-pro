import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { historicoOperacoes } from "@/data/mockData";
import { History, RotateCcw } from "lucide-react";

export default function Historico() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Histórico</h1>
        <p className="text-sm text-muted-foreground">Registro completo de todas as operações</p>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
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
              {historicoOperacoes.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-sm font-medium">{h.arquivo}</TableCell>
                  <TableCell className="text-sm">{h.fornecedor}</TableCell>
                  <TableCell className="text-sm">{h.usuario}</TableCell>
                  <TableCell className="text-sm">{h.data}</TableCell>
                  <TableCell className="text-xs">{h.tipoConversao}</TableCell>
                  <TableCell className="text-right text-sm">{h.qtdItens}</TableCell>
                  <TableCell><StatusBadge status={h.status} /></TableCell>
                  <TableCell><Button variant="ghost" size="sm" className="text-xs"><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reabrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
