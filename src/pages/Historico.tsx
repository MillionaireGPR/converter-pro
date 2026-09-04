import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { useHistorico } from "@/context/HistoricoContext";
import { useProdutos } from "@/context/ProdutosContext";
import { useApp } from "@/context/AppContext";
import { History, RotateCcw, Inbox, Download, Trash2, Image, Server, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";
import { saveAs } from "file-saver";

const routeMap: Record<string, string> = {
  'Importação de Produtos': '/base',
  'Exportação Mercos': '/exportacoes',
  'Catálogo Gerado': '/descontos',
  'Conversão de Pedido': '/pedidos',
  'Validação de Produtos': '/base',
  'Aplicação de Desconto': '/descontos',
  'Exportação Excel': '/descontos',
};

/** Rótulo + cor por servidor — mesmos códigos de `backendLabel()`.
 *  A ordem numérica acompanha o painel central de infraestrutura. */
const servidorBadge: Record<string, { label: string; className: string }> = {
  integrator: { label: 'Integrator (servidor 1)', className: 'bg-success/10 text-success border-success/20' },
  proprio: { label: 'Wesley (servidor 2)', className: 'bg-warning/10 text-warning border-warning/20' },
  render: { label: 'Render (servidor 3)', className: 'bg-muted text-muted-foreground border-border' },
  local: { label: 'local (dev)', className: 'bg-muted text-muted-foreground' },
  outro: { label: 'outro', className: 'bg-muted text-muted-foreground' },
};

export default function Historico() {
  const { historico, conversoesSalvas, reabrirConversao, excluirConversao, exportarImagensConversao } = useHistorico();
  const { setProdutosPadronizados } = useProdutos();
  const { setDetectedHeaders } = useApp();
  const navigate = useNavigate();
  const [conversaoAtiva, setConversaoAtiva] = useState<string | null>(null);

  const handleReabrir = async (op: typeof historico[0]) => {
    // Tentar reabrir uma conversão salva primeiro
    const conversaoRelacionada = conversoesSalvas.find(c => 
      c.arquivo === op.arquivo && c.fornecedor === op.fornecedor
    );
    
    if (conversaoRelacionada) {
      setConversaoAtiva(conversaoRelacionada.id);
      const resultado = await reabrirConversao(conversaoRelacionada.id);
      setConversaoAtiva(null);
      
      if (resultado) {
        if (resultado.produtos && resultado.produtos.length > 0) setProdutosPadronizados(resultado.produtos);
        if (resultado.headers && resultado.headers.length > 0) setDetectedHeaders(resultado.headers);
        
        // Navegar para a base padronizada onde os produtos foram carregados
        navigate('/base');
        return;
      }
    }
    
    // Fallback: navegar para a rota padrão
    const route = routeMap[op.tipoConversao];
    if (route) {
      navigate(route);
      toast.info(`Navegando para ${op.tipoConversao}`);
    } else {
      toast.info("Visualização não disponível para este tipo");
    }
  };

  const handleBaixarImagens = async (id: string, arquivo: string) => {
    setConversaoAtiva(id);
    const resultado = await exportarImagensConversao(id);
    setConversaoAtiva(null);
    
    if (resultado.sucesso && resultado.zipBlob) {
      const fileName = arquivo.replace(/\.[^/.]+$/, '') + '_imagens.zip';
      saveAs(resultado.zipBlob, fileName);
      toast.success(resultado.mensagem);
    } else {
      toast.error(resultado.mensagem);
    }
  };

  const handleExcluirConversao = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta conversão do histórico?')) {
      await excluirConversao(id);
    }
  };

  /** Baixa o relatório de falhas gravado no banco (27/08/2026) — funciona de
   *  qualquer máquina, diferente do botão na tela de Conversão que só existe
   *  enquanto o job está na memória daquele navegador. */
  const handleBaixarRelatorioFalhas = (arquivo: string, relatorioFalhas: string) => {
    const blob = new Blob([relatorioFalhas], { type: "text/plain;charset=utf-8" });
    saveAs(blob, `relatorio_falhas_match_${arquivo}.txt`);
    toast.success("Relatório de falhas baixado!");
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
                  <TableHead>Servidor</TableHead>
                  <TableHead>Imagens</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map(h => {
                  // Verificar se existe uma conversão salva para esta operação
                  const conversao = conversoesSalvas.find(c =>
                    c.arquivo === h.arquivo && c.fornecedor === h.fornecedor
                  );
                  const temImagens = conversao && conversao.imagens && conversao.imagens.length > 0;
                  const isLoading = conversaoAtiva === conversao?.id;
                  const badge = h.servidor ? servidorBadge[h.servidor] : undefined;
                  const temFalhaImagem = (h.imagensFalhas ?? 0) > 0;
                  // Marcação visual (pedido do Gabriel, 27/08/2026): linha com
                  // falha de imagem ou erro geral fica com borda de alerta —
                  // dá pra bater o olho no histórico e achar o problema sem
                  // abrir cada linha.
                  const linhaComProblema = temFalhaImagem || h.status === 'erro';

                  return (
                    <TableRow key={h.id} className={linhaComProblema ? 'border-l-2 border-l-warning' : undefined}>
                      <TableCell className="text-sm font-medium">{h.arquivo}</TableCell>
                      <TableCell className="text-sm">{h.fornecedor}</TableCell>
                      <TableCell className="text-sm">{h.usuario}</TableCell>
                      <TableCell className="text-sm">{h.data}</TableCell>
                      <TableCell className="text-xs">{h.tipoConversao}</TableCell>
                      <TableCell className="text-right text-sm">{h.qtdItens}</TableCell>
                      <TableCell>
                        {badge ? (
                          <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
                            <Server className="h-3 w-3 mr-1" />{badge.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {h.imagensEncontradas != null ? (
                          <div className="flex items-center gap-1">
                            <span className={`text-xs ${temFalhaImagem ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                              {h.imagensAssociadas ?? 0}/{h.imagensEncontradas}
                              {temFalhaImagem && ` (${h.imagensFalhas} falhas)`}
                            </span>
                            {temFalhaImagem && <AlertTriangle className="h-3 w-3 text-warning" />}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={h.status} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {/* Botão Reabrir - sempre disponível */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => handleReabrir(h)}
                            disabled={isLoading}
                          >
                            <RotateCcw className={`h-3.5 w-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                            {isLoading ? 'Carregando...' : 'Reabrir'}
                          </Button>

                          {/* Botão Baixar Imagens - apenas se tiver imagens */}
                          {temImagens && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-primary"
                              onClick={() => conversao && handleBaixarImagens(conversao.id, conversao.arquivo)}
                              disabled={isLoading}
                              title={`Baixar ${conversao?.imagens?.length} imagens`}
                            >
                              <Image className="h-3.5 w-3.5 mr-1" />
                              Imagens ({conversao?.imagens?.length})
                            </Button>
                          )}

                          {/* Botão Baixar Relatório de Falhas - vem do banco,
                              funciona de qualquer máquina (27/08/2026) */}
                          {h.relatorioFalhas && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-warning"
                              onClick={() => handleBaixarRelatorioFalhas(h.arquivo, h.relatorioFalhas!)}
                              title={`Baixar relatório de ${h.imagensFalhas} falhas`}
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              Falhas ({h.imagensFalhas})
                            </Button>
                          )}

                          {/* Botão Excluir - apenas se tiver conversão salva */}
                          {conversao && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-destructive"
                              onClick={() => handleExcluirConversao(conversao.id)}
                              disabled={isLoading}
                              title="Excluir do histórico"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
