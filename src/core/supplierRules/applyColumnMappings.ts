// ===================================================================
// MAPEAMENTO EXPLÍCITO DE COLUNAS POR FORNECEDOR (19/08/2026)
// ===================================================================
// Antes, cada planilha com nome de coluna fora do padrão exigia um alias
// novo no código + PR + deploy (ex.: VAESO chamava a quantidade de
// "Caixa master", e o campo saía com o default 1 EM SILÊNCIO). Isso
// prendia o produto ao desenvolvedor e fazia o cliente reportar a mesma
// classe de erro a cada fornecedor novo.
//
// Aqui o cliente configura UMA VEZ, por fornecedor, de qual coluna vem
// cada campo — e isso passa a valer para todas as conversões seguintes.
//
// Como vence a detecção automática: o nome da coluna escolhida é colocado
// na FRENTE da lista de aliases do campo. O `findValue` do extractor tenta
// match exato antes de qualquer heurística, então a escolha do cliente é
// consultada primeiro. Os aliases originais continuam como fallback — se
// o fornecedor renomear a coluna, o sistema ainda tenta se virar sozinho.
// ===================================================================

import { SupplierAdapter } from './types';
import { findMatchingKey } from './extractor';
import { CAMPOS_MERCOS, CAMPOS_ESSENCIAIS, MAX_TABELAS_PRECO, precoTabelaKey } from './camposMercos';

/** campo do sistema → nome exato da coluna na planilha do fornecedor. */
export type ColumnMappings = Record<string, string>;

// Reexportados: a lista de campos passou a viver em `camposMercos.ts` (fonte
// única que alimenta tela de regras, conferência do upload e export).
export { MAX_TABELAS_PRECO, precoTabelaKey };

/** Extrai, na ordem, as colunas mapeadas para tabelas de preço extra.
 *  Buracos viram string vazia para preservar a posição (#1, #2, #3...). */
export function tabelaPrecoColumns(mappings?: ColumnMappings | null): string[] {
  if (!mappings) return [];
  const cols: string[] = [];
  let maiorPreenchido = 0;
  for (let n = 1; n <= MAX_TABELAS_PRECO; n++) {
    const col = (mappings[precoTabelaKey(n)] || '').trim();
    cols.push(col);
    if (col) maiorPreenchido = n;
  }
  return cols.slice(0, maiorPreenchido);
}

/**
 * Devolve uma CÓPIA do adapter com as colunas escolhidas pelo cliente na
 * frente dos aliases de cada campo.
 *
 * Copia em vez de mutar porque os adapters são singletons do registry —
 * mutar vazaria a config de um fornecedor para os outros dentro da mesma
 * sessão do navegador.
 */
export function applyColumnMappings(
  adapter: SupplierAdapter,
  mappings?: ColumnMappings | null
): SupplierAdapter {
  if (!mappings || Object.keys(mappings).length === 0) return adapter;

  const fieldAliases: Record<string, string[]> = {};
  for (const [campo, aliases] of Object.entries(adapter.fieldAliases || {})) {
    fieldAliases[campo] = [...(aliases as string[])];
  }

  let aplicados = 0;
  for (const [campo, coluna] of Object.entries(mappings)) {
    const col = (coluna || '').trim();
    if (!col) continue;
    // precoTabelaN não é campo de adapter — é tratado à parte no extractor.
    if (/^precoTabela\d+$/.test(campo)) continue;
    if (!fieldAliases[campo]) fieldAliases[campo] = [];
    if (!fieldAliases[campo].includes(col)) {
      fieldAliases[campo].unshift(col);
      aplicados++;
    }
  }

  if (aplicados === 0) return adapter;
  console.log(`[ColumnMappings] ${aplicados} coluna(s) definidas pelo cliente para "${adapter.nome}"`);
  return { ...adapter, fieldAliases: fieldAliases as any };
}

// ===================================================================
// PRÉVIA DO MAPEAMENTO (19/08/2026)
// ===================================================================
// Mostrada ao usuário logo após escolher o arquivo, ANTES de converter:
// "de qual coluna virá cada informação". Assim o erro aparece na hora,
// e não depois de exportar pro Mercos com dado errado (foi o que houve
// com a VAESO: quantidade saiu 1 em silêncio e só o cliente percebeu).
//
// Usa findMatchingKey — a MESMA função do extractor — de propósito: se a
// prévia reimplementasse o match, ela poderia divergir do que acontece de
// verdade, e uma tela que mente sobre o mapeamento é pior que tela nenhuma.

/** Campos sempre conferidos no upload, mapeados ou não — é o que quebra na
 *  prática. Os demais campos do Mercos só aparecem quando o cliente mapeia
 *  (senão a conferência viraria uma lista de 40 linhas quase toda vazia). */
export const CAMPOS_CONFERIVEIS: { campo: string; rotulo: string }[] =
  CAMPOS_ESSENCIAIS.map(({ campo, rotulo }) => ({ campo, rotulo }));

export type OrigemMapeamento = 'cliente' | 'auto' | 'nenhuma';

export interface LinhaPrevia {
  campo: string;
  rotulo: string;
  /** Coluna da planilha que vai alimentar este campo ('' = nenhuma). */
  coluna: string;
  /** cliente = configurado na tela; auto = o sistema deduziu;
   *  nenhuma = ninguém achou, o campo virá vazio/default. */
  origem: OrigemMapeamento;
}

/**
 * Para cada campo conferível, diz de qual coluna ele virá e por quê.
 * `headers` são os cabeçalhos reais lidos da planilha escolhida.
 */
export function previewColumnMapping(
  headers: string[],
  adapter: SupplierAdapter,
  mappings?: ColumnMappings | null
): LinhaPrevia[] {
  const linhas: LinhaPrevia[] = [];

  for (const { campo, rotulo } of CAMPOS_CONFERIVEIS) {
    const escolhaCliente = (mappings?.[campo] || '').trim();
    if (escolhaCliente) {
      linhas.push({ campo, rotulo, coluna: escolhaCliente, origem: 'cliente' });
      continue;
    }
    const aliases = (adapter.fieldAliases as any)?.[campo] as string[] | undefined;
    const auto = aliases ? findMatchingKey(headers, aliases) : undefined;
    linhas.push({
      campo,
      rotulo,
      coluna: auto || '',
      origem: auto ? 'auto' : 'nenhuma',
    });
  }

  // Os demais campos do Mercos (peso, dimensões, estoque, comissão, tamanhos,
  // tabelas de preço extra...) só aparecem quando o cliente mapeou. Não dá pra
  // deduzir sozinho que "V50" é a tabela de 50%, e listar 40 linhas vazias
  // esconderia justamente as que importam.
  const jaListados = new Set(linhas.map(l => l.campo));
  for (const { campo, rotulo } of CAMPOS_MERCOS) {
    if (jaListados.has(campo)) continue;
    const col = (mappings?.[campo] || '').trim();
    if (!col) continue;
    linhas.push({ campo, rotulo, coluna: col, origem: 'cliente' });
  }

  return linhas;
}
