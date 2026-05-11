import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { useProdutos } from "@/context/ProdutosContext";
import { useFornecedores } from "@/context/FornecedoresContext";
import { useHistorico } from "@/context/HistoricoContext";
import { supabase } from "@/integrations/supabase/client";
import { Eye, FileDown, FileSpreadsheet, Save, Tag, Sparkles, Package, Percent, Lock, Unlock, Filter, Shield, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import logo from "@/assets/logo-nunes.png";

export default function DescontosCatalogos() {
  const { gerarCatalogo } = useApp();
  const { produtosPadronizados, setProdutosPadronizados, aplicarDesconto, aplicarIpi } = useProdutos();
  const { fornecedores } = useFornecedores();
  const { registrarHistorico } = useHistorico();
  const navigate = useNavigate();
  const [fornecedor, setFornecedor] = useState("");
  const [descontoPrincipal, setDescontoPrincipal] = useState("");
  const [descontoAdicional, setDescontoAdicional] = useState("");
  const [campanha, setCampanha] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [usarPrecoFinal, setUsarPrecoFinal] = useState(false);
  const [mostrarDesconto, setMostrarDesconto] = useState(true);
  
  // Estado para IPI em massa
  const [novoIpi, setNovoIpi] = useState("");
  
  // Estado para DESCONTO no IPI (percentual de redução)
  const [descontoIpi, setDescontoIpi] = useState("");
  
  // Estado para modo de IPI: 'incluso' = já está no preço, 'somar' = adicionar ao preço
  const [ipiModo, setIpiModo] = useState<'incluso' | 'somar'>('incluso');
  
  // Filtros de categoria visual
  const [filtroVisual, setFiltroVisual] = useState<'todos' | 'promocional' | 'preco-fixo' | 'novidade' | 'reposicao' | 'liberados' | 'bloqueados'>('todos');
  
  // Estado para seleção de categorias para bloqueio em massa
  const [categoriasParaBloquear, setCategoriasParaBloquear] = useState<{
    promocional: boolean;
    precoFixo: boolean;
    novidade: boolean;
    reposicao: boolean;
  }>({ promocional: false, precoFixo: false, novidade: false, reposicao: false });
  const [bloqueandoCategoria, setBloqueandoCategoria] = useState(false);

  const forn = fornecedores.find(f => f.id === fornecedor);
  const fornNome = forn?.nome;
  
  // Filtra por ID ou por NOME (caso o banco não tenha retornado o ID corretamente)
  const produtosPorFornecedor = forn 
    ? produtosPadronizados.filter(p => p.fornecedorId === forn.id || p.fornecedor.toLowerCase() === forn.nome.toLowerCase()) 
    : produtosPadronizados;
    
  // Aplicar filtro visual por cima (agora suporta múltiplas categorias via visualTags)
  const produtosFiltrados = produtosPorFornecedor.filter(p => {
    switch (filtroVisual) {
      case 'promocional': return p.visualTags?.includes('promocional');
      case 'preco-fixo': return p.visualTags?.includes('preco-fixo');
      case 'novidade': return p.visualTags?.includes('novidade');
      case 'reposicao': return p.visualTags?.includes('reposicao');
      case 'liberados': return !p.bloqueiaDesconto;
      case 'bloqueados': return !!p.bloqueiaDesconto;
      default: return true;
    }
  });
  
  // Contadores para os filtros (suporta múltiplas categorias - um produto pode contar em vários)
  const contadores = {
    total: produtosPorFornecedor.length,
    promocionais: produtosPorFornecedor.filter(p => p.visualTags?.includes('promocional')).length,
    precoFixo: produtosPorFornecedor.filter(p => p.visualTags?.includes('preco-fixo')).length,
    novidade: produtosPorFornecedor.filter(p => p.visualTags?.includes('novidade')).length,
    reposicao: produtosPorFornecedor.filter(p => p.visualTags?.includes('reposicao')).length,
    bloqueados: produtosPorFornecedor.filter(p => !!p.bloqueiaDesconto).length,
    liberados: produtosPorFornecedor.filter(p => !p.bloqueiaDesconto).length,
  };

  const fornecedoresComProdutos = fornecedores
    .filter(f => 
      produtosPadronizados.some(p => p.fornecedorId === f.id || p.fornecedor.toLowerCase() === f.nome.toLowerCase())
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Calculadora de desconto composto do formato "30+15+10"
  const d1 = parseFloat(descontoPrincipal) || 0;
  const d2 = parseFloat(descontoAdicional) || 0;
  
  const calcularEquivalente = (p1: number, p2: number) => {
    const mult = (1 - p1 / 100) * (1 - p2 / 100);
    return +((1 - mult) * 100).toFixed(2);
  };

  const descNum = calcularEquivalente(d1, d2);
  const descontoString = d2 > 0 ? `${d1}+${d2}` : `${d1}`;
  const valido = d1 >= 0 && d1 <= 100 && d2 >= 0 && d2 <= 100;

  // IPI
  const ipiNumero = parseFloat(novoIpi);
  const ipiValido = novoIpi !== "" && !isNaN(ipiNumero) && ipiNumero >= 0 && ipiNumero <= 100;
  
  // Desconto no IPI
  const descontoIpiNum = parseFloat(descontoIpi) || 0;
  const descontoIpiValido = descontoIpi !== "" && !isNaN(descontoIpiNum) && descontoIpiNum > 0 && descontoIpiNum <= 100;

  const handleSalvar = async () => {
    if (!valido) { toast.error("Por favor, informe descontos válidos entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos para aplicar desconto"); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      console.log(`[Flow MVP] Enviando desconto composto:`, { d1, d2, equivalente: descNum });
      await aplicarDesconto(ids, descNum, campanha, fornNome, descontoString);
      toast.success(`Desconto de ${descontoString}% salvo para ${ids.length} produto(s)!`);
    } catch (err) {
      toast.error("Erro ao salvar descontos no banco.");
    }
  };

  const handleSalvarIpi = async () => {
    if (!ipiValido) { toast.error("Informe um IPI válido entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Selecione um fornecedor com produtos."); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      await aplicarIpi(ids, ipiNumero, fornNome);
      toast.success(`IPI de ${ipiNumero}% aplicado em ${ids.length} produto(s)!`);
    } catch (err) {
      toast.error("Erro ao salvar IPI no banco.");
    }
  };

  const handleAplicarDescontoIpi = async () => {
    if (!descontoIpiValido) { toast.error("Informe um desconto de IPI válido entre 0 e 100."); return; }
    if (!produtosFiltrados.length) { toast.error("Selecione um fornecedor com produtos."); return; }
    try {
      const ids = produtosFiltrados.map(p => p.id);
      // Calcula novo IPI para cada produto: IPI atual * (1 - desconto/100)
      const updates = produtosFiltrados.map(p => {
        const ipiAtual = p.ipi || 0;
        const novoIpi = ipiAtual * (1 - descontoIpiNum / 100);
        return { id: p.id, ipi: Math.max(0, +novoIpi.toFixed(2)) };
      });
      
      // Aplica atualização em lote
      await aplicarIpi(ids, 0, fornNome, updates); // Passa 0 como valor único e usa updates
      toast.success(`Desconto de ${descontoIpiNum}% aplicado no IPI de ${ids.length} produto(s)!`);
      console.log('[Flow MVP] Desconto no IPI aplicado:', { descontoIpiNum, updates });
    } catch (err) {
      toast.error("Erro ao aplicar desconto no IPI.");
    }
  };

  // === BLOQUEAR DESCONTOS POR CATEGORIA ===
  const handleBloquearPorCategoria = async () => {
    if (!categoriasParaBloquear.promocional && !categoriasParaBloquear.precoFixo && !categoriasParaBloquear.novidade && !categoriasParaBloquear.reposicao) {
      toast.error("Selecione pelo menos uma categoria para bloquear.");
      return;
    }

    setBloqueandoCategoria(true);
    
    try {
      // Determinar quais categorias bloquear
      const categoriasBloquear: string[] = [];
      if (categoriasParaBloquear.promocional) categoriasBloquear.push('promocional');
      if (categoriasParaBloquear.precoFixo) categoriasBloquear.push('preco-fixo');
      if (categoriasParaBloquear.novidade) categoriasBloquear.push('novidade');
      if (categoriasParaBloquear.reposicao) categoriasBloquear.push('reposicao');

      // Filtrar produtos que precisam ser bloqueados (estão nos produtos filtrados atualmente)
      // Agora verifica visualTags para suportar múltiplas categorias
      const produtosParaBloquear = produtosFiltrados.filter(p => 
        categoriasBloquear.some(cat => p.visualTags?.includes(cat as any)) && !p.bloqueiaDesconto
      );

      if (produtosParaBloquear.length === 0) {
        toast.info("Nenhum produto da categoria selecionada precisa ser bloqueado.");
        setBloqueandoCategoria(false);
        return;
      }

      console.log(`[BloqueioCategoria] Bloqueando ${produtosParaBloquear.length} produtos:`, categoriasBloquear);

      // Atualizar no Supabase em lote
      const updates = await Promise.all(
        produtosParaBloquear.map(async (p) => {
          try {
            const { error } = await (supabase.from('standardized_products') as any)
              .update({ 
                bloqueia_desconto: true,
                visual_category: p.visualCategory,
                is_promotional: p.visualCategory === 'promocional',
                is_fixed_price: p.visualCategory === 'preco-fixo'
              })
              .eq('id', p.id);
            
            if (error) {
              console.warn(`[BloqueioCategoria] Erro no produto ${p.id}:`, error);
              return null;
            }
            return p.id;
          } catch (e) {
            console.warn(`[BloqueioCategoria] Erro no produto ${p.id}:`, e);
            return null;
          }
        })
      );

      const sucessos = updates.filter(Boolean);
      
      // Atualizar estado local
      const produtosAtualizados = produtosParaBloquear.map(p => ({
        ...p,
        bloqueiaDesconto: true,
        isPromotional: p.visualCategory === 'promocional',
        isFixedPrice: p.visualCategory === 'preco-fixo'
      }));

      // Atualizar o estado global
      setProdutosPadronizados?.(prev => prev.map(p => {
        const atualizado = produtosAtualizados.find(u => u.id === p.id);
        return atualizado || p;
      }));

      toast.success(`${sucessos.length} produto(s) bloqueados com sucesso! Descontos não serão aplicados a eles.`);
      
      // Resetar seleção
      setCategoriasParaBloquear({ promocional: false, precoFixo: false, novidade: false, reposicao: false });
      
    } catch (err) {
      console.error("[BloqueioCategoria] Erro:", err);
      toast.error("Erro ao bloquear descontos por categoria.");
    } finally {
      setBloqueandoCategoria(false);
    }
  };

  // === DESBLOQUEAR DESCONTOS POR CATEGORIA ===
  const handleDesbloquearPorCategoria = async () => {
    if (!categoriasParaBloquear.promocional && !categoriasParaBloquear.precoFixo && !categoriasParaBloquear.novidade && !categoriasParaBloquear.reposicao) {
      toast.error("Selecione pelo menos uma categoria para desbloquear.");
      return;
    }

    setBloqueandoCategoria(true);
    
    try {
      // Determinar quais categorias desbloquear
      const categoriasDesbloquear: string[] = [];
      if (categoriasParaBloquear.promocional) categoriasDesbloquear.push('promocional');
      if (categoriasParaBloquear.precoFixo) categoriasDesbloquear.push('preco-fixo');
      if (categoriasParaBloquear.novidade) categoriasDesbloquear.push('novidade');
      if (categoriasParaBloquear.reposicao) categoriasDesbloquear.push('reposicao');

      // Filtrar produtos que precisam ser desbloqueados (estão bloqueados)
      // Agora verifica visualTags para suportar múltiplas categorias
      const produtosParaDesbloquear = produtosFiltrados.filter(p => 
        categoriasDesbloquear.some(cat => p.visualTags?.includes(cat as any)) && p.bloqueiaDesconto
      );

      if (produtosParaDesbloquear.length === 0) {
        toast.info("Nenhum produto da categoria selecionada está bloqueado.");
        setBloqueandoCategoria(false);
        return;
      }

      console.log(`[DesbloqueioCategoria] Desbloqueando ${produtosParaDesbloquear.length} produtos:`, categoriasDesbloquear);

      // Atualizar no Supabase em lote
      const updates = await Promise.all(
        produtosParaDesbloquear.map(async (p) => {
          try {
            const { error } = await (supabase.from('standardized_products') as any)
              .update({ 
                bloqueia_desconto: false,
                visual_category: p.visualCategory,
                is_promotional: p.visualCategory === 'promocional',
                is_fixed_price: p.visualCategory === 'preco-fixo'
              })
              .eq('id', p.id);
            
            if (error) {
              console.warn(`[DesbloqueioCategoria] Erro no produto ${p.id}:`, error);
              return null;
            }
            return p.id;
          } catch (e) {
            console.warn(`[DesbloqueioCategoria] Erro no produto ${p.id}:`, e);
            return null;
          }
        })
      );

      const sucessos = updates.filter(Boolean);
      
      // Atualizar estado local
      const produtosAtualizados = produtosParaDesbloquear.map(p => ({
        ...p,
        bloqueiaDesconto: false,
        isPromotional: p.visualCategory === 'promocional',
        isFixedPrice: p.visualCategory === 'preco-fixo'
      }));

      // Atualizar o estado global
      setProdutosPadronizados?.(prev => prev.map(p => {
        const atualizado = produtosAtualizados.find(u => u.id === p.id);
        return atualizado || p;
      }));

      toast.success(`${sucessos.length} produto(s) desbloqueados com sucesso! Descontos serão aplicados a eles.`);
      
      // Resetar seleção
      setCategoriasParaBloquear({ promocional: false, precoFixo: false, novidade: false, reposicao: false });
      
    } catch (err) {
      console.error("[DesbloqueioCategoria] Erro:", err);
      toast.error("Erro ao desbloquear descontos por categoria.");
    } finally {
      setBloqueandoCategoria(false);
    }
  };

  const handleGerarPDF = async () => {
    if (!valido) { toast.error("Formato de desconto inválido."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos."); return; }
    try {
      console.log(`[Flow MVP] Gerando PDF com opções:`, { usarPrecoFinal, mostrarDesconto, ipiModo });
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Catálogo Comercial - ${campanha}`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Fornecedor: ${fornNome || 'Todos'} | Itens: ${produtosFiltrados.length}`, 14, 28);
      
      // Construir head dinamicamente baseado nas opções
      let head: string[] = ['Código', 'Produto'];
      
      if (usarPrecoFinal) {
        // Modo preço final apenas: mostra só preço final e IPI se somar
        if (ipiModo === 'somar') {
          head = head.concat(['Preço Final', 'IPI', 'Total c/ IPI', 'Fornecedor']);
        } else {
          head = head.concat(['Preço Final', 'Fornecedor']);
        }
      } else {
        // Modo normal: pode mostrar ou não desconto
        if (mostrarDesconto) {
          head = head.concat(['Preço Original', 'Desconto', 'Preço Final']);
        } else {
          head = head.concat(['Preço']);
        }
        
        // Adicionar IPI se necessário
        if (ipiModo === 'somar') {
          head.push('IPI');
          head.push('Total');
        }
        
        head.push('Fornecedor');
      }
      
      const body = produtosFiltrados.map(p => {
        // REGRA CRÍTICA: Produtos bloqueados NÃO recebem desconto
        const isBloqueado = !!p.bloqueiaDesconto;
        
        // Calcular preço base com desconto (se não bloqueado)
        let precoComDesconto = isBloqueado ? p.precoBase : +(p.precoBase * (1 - descNum / 100)).toFixed(2);
        
        // Se usar preço final do produto (já salvo), usa ele (se não bloqueado)
        if (!isBloqueado && usarPrecoFinal && p.precoFinal) {
          precoComDesconto = p.precoFinal;
        }
        
        // Calcular IPI se modo 'somar'
        const ipiPercentual = p.ipi || 0;
        const valorIPI = ipiModo === 'somar' ? +(precoComDesconto * (ipiPercentual / 100)).toFixed(2) : 0;
        const precoTotal = +(precoComDesconto + valorIPI).toFixed(2);
        
        // Log de segurança
        console.log(`[DiscountEngine] PDF SKU=${p.codigoFinal || p.codigoOriginal} bloqueado=${isBloqueado} desconto_aplicado=${isBloqueado ? 0 : descNum}%`);
        
        // Montar linha dinamicamente
        let row: string[] = [
          p.codigoFinal || p.codigoOriginal,
          p.nome.substring(0, 45)
        ];
        
        if (usarPrecoFinal) {
          // Preço final apenas
          if (ipiModo === 'somar') {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`,
              `${ipiPercentual}%`,
              `R$ ${precoTotal.toFixed(2)}`,
              p.fornecedor
            ]);
          } else {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`,
              p.fornecedor
            ]);
          }
        } else {
          // Modo completo
          if (mostrarDesconto) {
            row = row.concat([
              `R$ ${p.precoBase.toFixed(2)}`,
              `${descontoString}%`,
              `R$ ${precoComDesconto.toFixed(2)}`
            ]);
          } else {
            row = row.concat([
              `R$ ${precoComDesconto.toFixed(2)}`
            ]);
          }
          
          if (ipiModo === 'somar') {
            row.push(`${ipiPercentual}%`);
            row.push(`R$ ${precoTotal.toFixed(2)}`);
          }
          
          row.push(p.fornecedor);
        }
        
        return row;
      });

      autoTable(doc, {
        startY: 35,
        head: [head],
        body: body,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [41, 128, 185] }
      });

      const fileName = `catalogo_${campanha.replace(/\s/g, '_').toLowerCase()}.pdf`;
      doc.save(fileName);

      await registrarHistorico({ arquivo: fileName, fornecedor: fornNome || 'Diversos', usuario: 'Admin', data: new Date().toISOString().replace('T', ' ').substring(0, 16), tipoConversao: 'Catálogo Gerado PDF', qtdItens: produtosFiltrados.length, status: 'concluído' });
      console.log(`[Flow MVP] Arquivo PDF gerado e baixado: ${fileName}`);
      toast.success("Catálogo PDF baixado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar catálogo em PDF.");
    }
  };

  const handleGerarExcel = async () => {
    if (!valido) { toast.error("Formato de desconto inválido."); return; }
    if (!produtosFiltrados.length) { toast.error("Sem produtos."); return; }
    try {
      console.log(`[Flow MVP] Gerando Excel com XLSX...`);
      const dataToExport = produtosFiltrados.map(p => {
        const isBloqueado = !!p.bloqueiaDesconto;
        const pf = isBloqueado ? p.precoBase : (usarPrecoFinal ? p.precoFinal : +(p.precoBase * (1 - descNum / 100)).toFixed(2));
        return {
          "Código": p.codigoFinal || p.codigoOriginal,
          "Produto": p.nome,
          "Preço Original": Number(p.precoBase).toFixed(2),
          "Desconto Aplicado": isBloqueado ? "BLOQUEADO" : `${descontoString}%`,
          "Preço Final": Number(pf).toFixed(2),
          "IPI": p.ipi || 0,
          "Bloqueia Desconto": isBloqueado ? "SIM" : "NÃO",
          "Fornecedor": p.fornecedor
        };
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
      const fileName = `catalogo_descontos_${Date.now()}.xlsx`;
      XLSX.writeFile(wb, fileName);

      await registrarHistorico({ arquivo: fileName, fornecedor: fornNome || 'Diversos', usuario: 'Admin', data: new Date().toISOString().replace('T', ' ').substring(0, 16), tipoConversao: 'Exportação Excel (Descontos)', qtdItens: produtosFiltrados.length, status: 'concluído' });
      console.log(`[Flow MVP] Arquivo Excel gerado e baixado: ${fileName}`);
      toast.success("Catálogo Excel baixado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar arquivo Excel.");
    }
  };

  if (produtosPadronizados.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Descontos e Catálogos</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure descontos, IPI e gere catálogos comerciais</p>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Nenhum produto na base</h3>
            <p className="text-sm text-muted-foreground mb-4">Processe produtos primeiro na Conversão de Produtos.</p>
            <Button variant="outline" onClick={() => navigate('/conversao')}>Ir para Conversão</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Descontos e Catálogos</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure descontos, IPI em massa e gere catálogos comerciais</p>
      </div>

      {/* AVISO: Salvar antes de exportar */}
      <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Atenção: Salve antes de exportar!</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Para que os descontos e IPI sejam aplicados na conversão Mercos ou no envio aos clientes, é obrigatório clicar no botão <strong>"Salvar"</strong> após configurar. Sem salvar, as alterações ficam apenas na tela.
          </p>
        </div>
      </div>

      {/* ══════════════ LINHA 1: CONTROLES + RESUMO ══════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Coluna Esquerda: Controles Compactos */}
        <div className="xl:col-span-7 space-y-3">
          <Card className="shadow-card">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" /> Configurar Desconto
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {/* Linha 1: Fornecedor + Descontos */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
                  <Select value={fornecedor} onValueChange={setFornecedor}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{fornecedoresComProdutos.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Principal (%)</label>
                  <Input type="number" value={descontoPrincipal} onChange={e => setDescontoPrincipal(e.target.value)} placeholder="Ex: 15" className={`h-9 text-sm ${!valido ? 'border-destructive' : ''}`} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Adicional (%)</label>
                  <Input type="number" value={descontoAdicional} onChange={e => setDescontoAdicional(e.target.value)} placeholder="0" className="h-9 text-sm" />
                </div>
              </div>

              {/* Campanha + Equivalente */}
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Campanha</label>
                  <Input value={campanha} onChange={e => setCampanha(e.target.value)} placeholder="Ex: Campanha Verão 2026" className="h-9 text-sm" />
                </div>
                {d2 > 0 && (
                  <div className="px-2 py-1 rounded bg-primary/5 text-primary text-xs font-medium whitespace-nowrap">
                    = {descNum}% total
                  </div>
                )}
              </div>

              {/* Switches em linha */}
              <div className="flex flex-wrap gap-4 pt-1">
                <div className="flex items-center gap-2">
                  <Switch 
                    checked={usarPrecoFinal} 
                    onCheckedChange={(checked) => {
                      setUsarPrecoFinal(checked);
                      if (checked) setMostrarDesconto(false);
                    }} 
                    className="scale-90"
                  />
                  <span className="text-xs text-muted-foreground">Só preço final</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    checked={mostrarDesconto} 
                    onCheckedChange={(checked) => {
                      setMostrarDesconto(checked);
                      if (checked) setUsarPrecoFinal(false);
                    }} 
                    className="scale-90"
                  />
                  <span className="text-xs text-muted-foreground">Mostrar %</span>
                </div>
              </div>

              {/* IPI em Massa - Unificado */}
              <div className="rounded-lg border border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/10 p-2.5 space-y-2">
                <div className="flex items-center gap-2 text-amber-700">
                  <Percent className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">IPI em Massa</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Novo IPI (%)</label>
                    <Input type="number" min="0" max="100" step="0.01" value={novoIpi} onChange={e => setNovoIpi(e.target.value)} placeholder="Ex: 9.75" className={`h-7 text-xs ${novoIpi !== "" && !ipiValido ? 'border-destructive' : ''}`} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Desc. no IPI (%)</label>
                    <Input type="number" min="0" max="100" step="0.01" value={descontoIpi} onChange={e => setDescontoIpi(e.target.value)} placeholder="Ex: 50" className={`h-7 text-xs ${descontoIpi !== "" && !descontoIpiValido ? 'border-destructive' : ''}`} />
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => setDescontoIpi("33.33")} className="text-[9px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition-colors" title="Reduz 1/3 do IPI">1/3</button>
                      <button onClick={() => setDescontoIpi("66.66")} className="text-[9px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition-colors" title="Reduz 2/3 do IPI">2/3</button>
                      <button onClick={() => setDescontoIpi("50")} className="text-[9px] px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition-colors" title="Reduz metade do IPI">1/2</button>
                    </div>
                  </div>
                </div>
                {descontoIpiValido && produtosFiltrados.length > 0 && (
                  <p className="text-[10px] text-amber-600">
                    Ex: IPI 6.5% vira {+(6.5 * (1 - descontoIpiNum * 0.01)).toFixed(2)}%
                    {descontoIpiNum === 33.33 && <span className="ml-1 font-medium">(= reduziu 1/3)</span>}
                    {descontoIpiNum === 66.66 && <span className="ml-1 font-medium">(= reduziu 2/3)</span>}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  <span className="font-medium">Dica:</span> Para reduzir 1/3 do IPI, use 33,33% de desconto
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white" size="sm" disabled={!ipiValido || !produtosFiltrados.length} onClick={handleSalvarIpi}>
                    <Save className="h-3 w-3 mr-1" /> Aplicar IPI
                  </Button>
                  <Button className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white" size="sm" disabled={!descontoIpiValido || !produtosFiltrados.length} onClick={handleAplicarDescontoIpi}>
                    <Percent className="h-3 w-3 mr-1" /> Desc. IPI
                  </Button>
                </div>
                <div className="flex items-center gap-4 pt-1 border-t border-amber-200/30">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="ipiModo" value="incluso" checked={ipiModo === 'incluso'} onChange={() => setIpiModo('incluso')} className="w-3 h-3" />
                    <span className="text-[10px]">Incluso</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="ipiModo" value="somar" checked={ipiModo === 'somar'} onChange={() => setIpiModo('somar')} className="w-3 h-3" />
                    <span className="text-[10px]">Somar</span>
                  </label>
                  {ipiModo === 'somar' && (
                    <span className="text-[10px] text-amber-600 ml-auto">Ex: R$100 + 10% = R$110</span>
                  )}
                </div>
              </div>

            </CardContent>
          </Card>
        </div>

        {/* Coluna Direita: Resumo e Ações */}
        <div className="xl:col-span-5 space-y-3">
          {/* Card Resumo */}
          <Card className="shadow-card overflow-hidden border-l-4 border-l-primary bg-gradient-to-br from-primary/5 to-background">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Resumo da Configuração</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fornecedor:</span>
                  <span className="font-medium">{fornNome || 'Todos'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Desconto:</span>
                  <span className="font-bold text-primary">{descNum}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IPI:</span>
                  <span className="font-medium">{ipiModo === 'incluso' ? 'Incluso' : 'Somar'}</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Itens afetados:</span>
                    <span className="text-2xl font-extrabold text-primary">{produtosFiltrados.length}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Métricas + Bloqueio por Categoria */}
          {(contadores.promocionais > 0 || contadores.precoFixo > 0 || contadores.novidade > 0 || contadores.reposicao > 0 || contadores.bloqueados > 0) && (
            <Card className="shadow-card overflow-hidden">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-semibold flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary" /> Métricas
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Liberados:</span>
                  <span className="font-medium text-green-600">{contadores.liberados}</span>
                </div>
                {contadores.bloqueados > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Bloqueados:</span>
                    <span className="font-medium text-red-600">{contadores.bloqueados}</span>
                  </div>
                )}
                {contadores.promocionais > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Promocionais:</span>
                    <span className="font-medium text-red-500">{contadores.promocionais}</span>
                  </div>
                )}
                {contadores.precoFixo > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Preço Fixo:</span>
                    <span className="font-medium text-blue-500">{contadores.precoFixo}</span>
                  </div>
                )}
                {contadores.novidade > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Novidade:</span>
                    <span className="font-medium text-amber-500">{contadores.novidade}</span>
                  </div>
                )}
                {contadores.reposicao > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Reposição:</span>
                    <span className="font-medium text-emerald-500">{contadores.reposicao}</span>
                  </div>
                )}
                
                {/* Bloquear/Desbloquear por Categoria - Dentro do card de métricas */}
                <div className="border-t pt-2 mt-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-muted-foreground">Bloquear/Desbloquear:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    <button 
                      onClick={() => setCategoriasParaBloquear(prev => ({ ...prev, promocional: !prev.promocional }))} 
                      className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${categoriasParaBloquear.promocional ? 'bg-red-500 text-white' : 'bg-red-50 border border-red-200 text-red-700'}`}
                    >
                      {categoriasParaBloquear.promocional ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                      Promo ({contadores.promocionais})
                    </button>
                    <button 
                      onClick={() => setCategoriasParaBloquear(prev => ({ ...prev, precoFixo: !prev.precoFixo }))} 
                      className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${categoriasParaBloquear.precoFixo ? 'bg-blue-500 text-white' : 'bg-blue-50 border border-blue-200 text-blue-700'}`}
                    >
                      {categoriasParaBloquear.precoFixo ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                      Fixo ({contadores.precoFixo})
                    </button>
                    <button 
                      onClick={() => setCategoriasParaBloquear(prev => ({ ...prev, novidade: !prev.novidade }))} 
                      className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${categoriasParaBloquear.novidade ? 'bg-amber-500 text-white' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}
                    >
                      {categoriasParaBloquear.novidade ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                      Novid ({contadores.novidade})
                    </button>
                    <button 
                      onClick={() => setCategoriasParaBloquear(prev => ({ ...prev, reposicao: !prev.reposicao }))} 
                      className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${categoriasParaBloquear.reposicao ? 'bg-emerald-500 text-white' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}
                    >
                      {categoriasParaBloquear.reposicao ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                      Repos ({contadores.reposicao})
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <Button 
                      onClick={handleBloquearPorCategoria} 
                      disabled={bloqueandoCategoria || (!categoriasParaBloquear.promocional && !categoriasParaBloquear.precoFixo && !categoriasParaBloquear.novidade && !categoriasParaBloquear.reposicao)} 
                      className="flex-1 h-7 bg-red-500 hover:bg-red-600 text-white" 
                      size="sm"
                      title="Bloquear categoria selecionada"
                    >
                      {bloqueandoCategoria ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                    </Button>
                    <Button 
                      onClick={handleDesbloquearPorCategoria} 
                      disabled={bloqueandoCategoria || (!categoriasParaBloquear.promocional && !categoriasParaBloquear.precoFixo && !categoriasParaBloquear.novidade && !categoriasParaBloquear.reposicao)} 
                      className="flex-1 h-7 bg-green-500 hover:bg-green-600 text-white" 
                      size="sm"
                      title="Desbloquear categoria selecionada"
                    >
                      {bloqueandoCategoria ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Botões de Ação */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setShowPreview(true)}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={handleSalvar}>
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
            <Button size="sm" className="h-9 gradient-primary text-primary-foreground gap-1 shadow-sm" onClick={handleGerarPDF}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button size="sm" className="h-9 gradient-success text-primary-foreground gap-1 shadow-sm" onClick={handleGerarExcel}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </Button>
          </div>
        </div>
      </div>

      {/* ══════════════ LINHA 2: TABELA DE PRODUTOS (FULL WIDTH) ══════════════ */}
      <Card className="shadow-card overflow-hidden">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">{showPreview ? "Preview do Catálogo" : "Produtos com Desconto"}</CardTitle>
          {!showPreview ? (
            <Button variant="ghost" size="sm" className="text-xs text-primary gap-1" onClick={() => setShowPreview(true)}>
              <Sparkles className="h-3 w-3" /> Ver catálogo
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowPreview(false)}>Ver tabela</Button>
          )}
        </CardHeader>
        <CardContent>
            {showPreview ? (
              <div className="rounded-xl border shadow-sm overflow-hidden">
                <div className="gradient-primary p-6 text-primary-foreground">
                  <div className="flex items-center gap-4">
                    <img src={logo} alt="Logo" className="w-14 h-14 rounded-full border-2 border-white/20 shadow-lg" />
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight">{campanha}</h2>
                      <p className="text-sm opacity-80">Nunes Representações • {fornNome || "Todos os Fornecedores"}</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 bg-card">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {produtosFiltrados.map(p => {
                      const isBloqueado = !!p.bloqueiaDesconto;
                      const pf = isBloqueado ? p.precoBase : (usarPrecoFinal ? p.precoFinal : +(p.precoBase * (1 - descNum / 100)).toFixed(2));
                      return (
                        <div key={p.id} className={`border rounded-xl p-4 bg-card ${isBloqueado ? 'border-amber-200 dark:border-amber-800/50' : ''}`}>
                          <div className="flex items-start justify-between">
                            <p className="font-mono text-[10px] text-primary/60 font-medium">{p.codigoFinal || p.codigoOriginal}</p>
                            {p.visualTags?.includes('promocional') && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white">PROMOÇÃO</span>
                            )}
                            {p.visualTags?.includes('preco-fixo') && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500 text-white">PREÇO FIXO</span>
                            )}
                            {p.visualTags?.includes('novidade') && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500 text-white">NOVIDADE</span>
                            )}
                            {p.visualTags?.includes('reposicao') && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500 text-white">REPOSIÇÃO</span>
                            )}
                          </div>
                          <p className="text-sm font-bold mt-1 text-foreground leading-tight">{p.nome}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{p.descricao}</p>
                          <div className="flex items-baseline gap-2 mt-3 pt-3 border-t">
                            {mostrarDesconto && !isBloqueado && <span className="text-xs line-through text-muted-foreground">R$ {p.precoBase.toFixed(2)}</span>}
                            <span className="text-lg font-extrabold text-primary">R$ {pf.toFixed(2)}</span>
                            {isBloqueado ? (
                              <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" /> s/ desconto</span>
                            ) : mostrarDesconto && (
                              <span className="text-[10px] font-semibold bg-success/10 text-success px-1.5 py-0.5 rounded-md">-{descontoString}%</span>
                            )}
                          </div>
                          {(p.ipi > 0) && (
                            <p className="text-[10px] text-amber-600 mt-1 font-medium">IPI: {p.ipi}%</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="px-5 py-3 bg-muted/50 border-t text-center">
                  <p className="text-[10px] text-muted-foreground">Tabela válida enquanto durarem os estoques • Preços sujeitos a alteração sem aviso prévio</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Filtros de categoria visual */}
                <div className="flex flex-wrap gap-2 items-center">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <button
                    onClick={() => setFiltroVisual('todos')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'todos' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                  >
                    Todos ({contadores.total})
                  </button>
                  {contadores.promocionais > 0 && (
                    <button
                      onClick={() => setFiltroVisual('promocional')}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'promocional' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400'}`}
                    >
                      Promoção ({contadores.promocionais})
                    </button>
                  )}
                  {contadores.precoFixo > 0 && (
                    <button
                      onClick={() => setFiltroVisual('preco-fixo')}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'preco-fixo' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400'}`}
                    >
                      Preço Fixo ({contadores.precoFixo})
                    </button>
                  )}
                  {contadores.novidade > 0 && (
                    <button
                      onClick={() => setFiltroVisual('novidade')}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'novidade' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400'}`}
                    >
                      Novidade ({contadores.novidade})
                    </button>
                  )}
                  {contadores.reposicao > 0 && (
                    <button
                      onClick={() => setFiltroVisual('reposicao')}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'reposicao' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400'}`}
                    >
                      Reposição ({contadores.reposicao})
                    </button>
                  )}
                  <button
                    onClick={() => setFiltroVisual('liberados')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'liberados' ? 'bg-green-500 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400'}`}
                  >
                    Liberados ({contadores.liberados})
                  </button>
                  {contadores.bloqueados > 0 && (
                    <button
                      onClick={() => setFiltroVisual('bloqueados')}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filtroVisual === 'bloqueados' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400'}`}
                    >
                      <Lock className="h-3 w-3 inline mr-1" />Bloqueados ({contadores.bloqueados})
                    </button>
                  )}
                </div>
                
                <div className="overflow-x-auto">
                  <Table className="premium-table">
                    <TableHeader>
                      <TableRow className="border-b-0">
                        <TableHead>Código</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Preço Original</TableHead>
                        <TableHead className="text-right">Desconto</TableHead>
                        <TableHead className="text-right">Preço Final</TableHead>
                        <TableHead className="text-center">IPI %</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtosFiltrados.map(p => {
                        const isBloqueado = !!p.bloqueiaDesconto;
                        const pf = isBloqueado ? p.precoBase : (usarPrecoFinal ? p.precoFinal : p.precoBase * (1 - descNum / 100));
                        return (
                          <TableRow key={p.id} className={isBloqueado ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                            <TableCell className="font-mono text-xs text-primary/80 font-medium">{p.codigoFinal || p.codigoOriginal}</TableCell>
                            <TableCell className="text-sm font-medium">
                              <div className="flex items-center gap-1.5">
                                {p.visualTags?.includes('promocional') && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500 text-white">PROMO</span>
                                )}
                                {p.visualTags?.includes('preco-fixo') && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500 text-white">FIXO</span>
                                )}
                                {p.visualTags?.includes('novidade') && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500 text-white">NOVO</span>
                                )}
                                {p.visualTags?.includes('reposicao') && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500 text-white">REPOS</span>
                                )}
                                {p.nome}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-muted-foreground">R$ {p.precoBase.toFixed(2)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums">
                              {isBloqueado ? (
                                <span className="text-amber-600 flex items-center justify-end gap-1"><Lock className="h-3 w-3" />BLOQ</span>
                              ) : (
                                <span className="text-primary">{descontoString}%</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm font-bold tabular-nums">R$ {pf.toFixed(2)}</TableCell>
                            <TableCell className="text-center text-sm tabular-nums">
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${p.ipi > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'text-muted-foreground'}`}>
                                {p.ipi > 0 ? `${p.ipi}%` : '-'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              {isBloqueado ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                  <Lock className="h-3 w-3" /> SIM
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                  NÃO
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
// END
