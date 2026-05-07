// ===================================================================
// EXPORT JAW WEB usando o TEMPLATE OFICIAL como base
// Carrega /templates/jaweb-template.xlsx (cópia exata do modelo enviado
// pelo cliente), preserva TODAS as cores, merges, fórmulas, fontes e
// bordas, e apenas preenche os valores nas células corretas.
// ===================================================================

import * as XLSX from 'xlsx-js-style';
import type { PedidoProcessado, PedidoCabecalho, ItemPedidoNormalizado } from './orderTypes';

const TEMPLATE_URL = '/templates/jaweb-template.xlsx';

// Carrega o template uma vez (cache em memória)
let cachedTemplate: ArrayBuffer | null = null;
const loadTemplate = async (): Promise<ArrayBuffer> => {
  if (cachedTemplate) return cachedTemplate.slice(0); // retorna cópia (evita mutação)
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Falha ao carregar template JAW WEB (HTTP ${res.status})`);
  cachedTemplate = await res.arrayBuffer();
  return cachedTemplate.slice(0);
};

// Mantém a célula existente do template (estilo, fórmula etc.) e só substitui o valor
const setCellValue = (
  sheet: XLSX.WorkSheet,
  cellRef: string,
  value: string | number | undefined | null
): void => {
  if (value === undefined || value === null || value === '') return;
  const existing = (sheet[cellRef] as XLSX.CellObject) || {};
  const isNum = typeof value === 'number';
  sheet[cellRef] = {
    ...existing,
    v: value,
    t: isNum ? 'n' : 's',
    // remove fórmula se houver (estamos sobrescrevendo com valor literal)
    f: undefined as any,
    // remove cache de fórmula
    w: isNum ? undefined : String(value),
  } as XLSX.CellObject;
};

// ───────────────────────────────────────────────────────────────
// Mapeamento dos campos do PedidoCabecalho → células do template
// (validado contra Modelo Pedido JAW WEB.xlsx)
// ───────────────────────────────────────────────────────────────

const fillCabecalho = (sheet: XLSX.WorkSheet, c: PedidoCabecalho): void => {
  // I4 = DATA, I5 = VENDEDOR, I7 = TAB.PRECO, I8 = PEDIDO EXTERNO
  setCellValue(sheet, 'I4', c.dataEmissao);
  setCellValue(sheet, 'I5', c.vendedor);
  setCellValue(sheet, 'I7', c.tabelaPreco);
  setCellValue(sheet, 'I8', c.pedidoExterno || c.numero);

  // CLIENTE: B8=CNPJ, D8=IE, B9=RzSocial, B10=Endereço, G10=N°, I10=Compl.
  setCellValue(sheet, 'B8', (c.clienteCnpj || '').replace(/\D/g, ''));
  setCellValue(sheet, 'D8', c.clienteIE);
  setCellValue(sheet, 'B9', c.clienteRazaoSocial);
  setCellValue(sheet, 'B10', c.clienteEndereco);
  setCellValue(sheet, 'G10', c.clienteNumero);
  setCellValue(sheet, 'I10', c.clienteComplemento);
  // B11=Bairro, D11=Cidade, G11=UF, I11=CEP
  setCellValue(sheet, 'B11', c.clienteBairro);
  setCellValue(sheet, 'D11', c.clienteCidade);
  setCellValue(sheet, 'G11', c.clienteUF);
  setCellValue(sheet, 'I11', c.clienteCEP);
  // B12=Email, D12=Email2, G12=Tel, I12=Tel2
  setCellValue(sheet, 'B12', c.clienteEmail);
  setCellValue(sheet, 'D12', c.clienteEmail2);
  setCellValue(sheet, 'G12', c.clienteTelefone);
  setCellValue(sheet, 'I12', c.clienteTelefone2);

  // TRANSPORTADORA: B15=CNPJ, D15=IE, G14=Frete tipo, B16=RzSocial
  setCellValue(sheet, 'B15', (c.transpCnpj || '').replace(/\D/g, ''));
  setCellValue(sheet, 'D15', c.transpIE);
  setCellValue(sheet, 'G14', c.fretePor || '');
  setCellValue(sheet, 'B16', c.transpNome);

  // Dados Adicionais
  setCellValue(sheet, 'B18', c.informacoesAdicionais);
};

// Preenche as linhas dos itens (linha 26 em diante; até linha 64 conforme template)
const fillItens = (sheet: XLSX.WorkSheet, itens: ItemPedidoNormalizado[]): void => {
  const ITEM_START = 26;
  const ITEM_END = 64;
  const maxItens = ITEM_END - ITEM_START + 1;

  if (itens.length > maxItens) {
    console.warn(`[JAW WEB] Pedido tem ${itens.length} itens, mas template suporta apenas ${maxItens}. Os excedentes serao ignorados.`);
  }

  itens.slice(0, maxItens).forEach((item, idx) => {
    const row = ITEM_START + idx;
    // A = Cód Prod., B:D = Descrição, E = Qtde, F = %Desc, G = Preço Unit, H = IPI
    // (I = Total e K = Tot.IPI são FÓRMULAS no template — não tocar)
    setCellValue(sheet, `A${row}`, item.codigo);
    setCellValue(sheet, `B${row}`, item.descricao);
    setCellValue(sheet, `E${row}`, item.quantidade);
    // Pedido Mercos vem com preço LÍQUIDO (já com desconto e IPI aplicados)
    // → setamos %Desc=0 e IPI=0 e G = preço final, para que I = E*G corresponda ao subtotal
    setCellValue(sheet, `F${row}`, 0);
    setCellValue(sheet, `G${row}`, item.precoUnitario);
    setCellValue(sheet, `H${row}`, 0);
  });
};

// ───────────────────────────────────────────────────────────────
// API pública: gera Blob do XLSX preenchido sobre o template
// ───────────────────────────────────────────────────────────────

export const exportarPedidoJawebFromTemplate = async (
  pedido: PedidoProcessado
): Promise<{ blob: Blob; filename: string }> => {
  const buffer = await loadTemplate();
  const workbook = XLSX.read(buffer, { type: 'array', cellStyles: true, cellNF: true });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Preenche cabeçalho + itens preservando estilos
  if (pedido.cabecalho) fillCabecalho(sheet, pedido.cabecalho);
  fillItens(sheet, pedido.itens);

  // Gera blob preservando estilos
  const out = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    cellStyles: true,
  });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const date = new Date().toISOString().slice(0, 10);
  const num = pedido.cabecalho?.numero ? `_${pedido.cabecalho.numero}` : '';
  const filename = `pedido_jaweb${num}_${date}.xlsx`;

  return { blob, filename };
};
