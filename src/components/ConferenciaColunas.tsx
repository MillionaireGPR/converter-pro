import { useEffect, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { getAdapterById, getGenericAdapter } from "@/core/supplierRules/registry";
import {
  previewColumnMapping,
  precoTabelaKey,
  type ColumnMappings,
  type LinhaPrevia,
} from "@/core/supplierRules/applyColumnMappings";
import { findHeaderRowIndex } from "@/core/autoMapper";

/**
 * Painel de conferência das colunas, mostrado logo APÓS escolher a planilha
 * e ANTES de converter (19/08/2026).
 *
 * Motivação real: a VAESO saiu com quantidade 1 em TODOS os itens e ninguém
 * percebeu até o arquivo chegar no Mercos — o sistema não tinha como avisar
 * que não achou a coluna. Aqui o cliente vê de onde virá cada informação e
 * corrige na hora; a correção fica salva no fornecedor e não se repete.
 *
 * Só aparece para planilha: catálogo PDF não tem coluna.
 */
interface Props {
  file: File;
  supplierId?: string;
  supplierName?: string;
  mappings?: ColumnMappings;
  /** Salva o ajuste no fornecedor (persiste em suppliers.column_mappings). */
  onSalvar: (campo: string, coluna: string) => void;
}

/** Lê só os cabeçalhos da planilha — barato, não processa as linhas. */
async function lerCabecalhos(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Mesma heurística de cabeçalho do pipeline: a planilha pode ter título,
  // logo ou linhas em branco antes da linha real de cabeçalho.
  const idx = findHeaderRowIndex(linhas);
  return (linhas[idx] || []).map((c: any) => String(c ?? "").trim()).filter(Boolean);
}

export function ConferenciaColunas({ file, supplierId, supplierName, mappings, onSalvar }: Props) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<LinhaPrevia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    lerCabecalhos(file)
      .then(hs => {
        if (cancelado) return;
        const adapter =
          getAdapterById(supplierId || supplierName || "") || getGenericAdapter();
        setHeaders(hs);
        setLinhas(previewColumnMapping(hs, adapter, mappings));
      })
      .catch(e => {
        if (!cancelado) setErro(e?.message || "Não foi possível ler as colunas.");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => { cancelado = true; };
  }, [file, supplierId, supplierName, mappings]);

  const trocar = (campo: string, coluna: string) => {
    const valor = coluna === "__nenhuma__" ? "" : coluna;
    setLinhas(prev =>
      prev.map(l => (l.campo === campo ? { ...l, coluna: valor, origem: valor ? "cliente" : "nenhuma" } : l))
    );
    onSalvar(campo, valor);
  };

  if (carregando) {
    return (
      <Card className="mt-4">
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo as colunas da planilha...
        </CardContent>
      </Card>
    );
  }

  // Falha ao ler não pode travar a conversão — o pipeline segue com a
  // detecção automática, exatamente como antes deste painel existir.
  if (erro || headers.length === 0) return null;

  const semColuna = linhas.filter(l => l.origem === "nenhuma" && !l.campo.startsWith("precoTabela"));

  return (
    <Card className="mt-4">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-sm">Confira de onde vem cada informação</h3>
            <p className="text-xs text-muted-foreground">
              O ajuste fica salvo neste fornecedor — você só precisa fazer uma vez.
            </p>
          </div>
          {semColuna.length > 0 ? (
            <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1">
              <AlertTriangle className="h-3 w-3" />
              {semColuna.length} sem coluna
            </Badge>
          ) : (
            <Badge variant="outline" className="text-emerald-600 border-emerald-300 gap-1">
              <CheckCircle2 className="h-3 w-3" /> tudo identificado
            </Badge>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {linhas.map(l => (
            <div key={l.campo} className="flex items-center gap-2">
              <span className="text-xs w-40 shrink-0 text-muted-foreground">{l.rotulo}</span>
              <Select
                value={l.coluna || "__nenhuma__"}
                onValueChange={v => trocar(l.campo, v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhuma__">— não usar —</SelectItem>
                  {headers.map(h => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {l.origem === "cliente" && (
                <Badge variant="secondary" className="text-[10px] shrink-0">definido</Badge>
              )}
            </div>
          ))}
        </div>

        {/* Tabelas de preço extra não têm como ser deduzidas (não dá pra saber
            que "V50" é a tabela de 50%), então só aparecem se configuradas. */}
        {!linhas.some(l => l.campo === precoTabelaKey(1)) && (
          <p className="text-[11px] text-muted-foreground">
            Tem mais de uma tabela de preço? Configure em <strong>Regras de Colunas</strong>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
