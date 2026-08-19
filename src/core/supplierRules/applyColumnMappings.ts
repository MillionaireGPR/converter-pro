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

/** campo do sistema → nome exato da coluna na planilha do fornecedor. */
export type ColumnMappings = Record<string, string>;

/** Campos de preço extra (VAESO: V50/V250/V.R.). Índice N → "Preço de
 *  Tabela #N (opcional)" no export Mercos. O Mercos aceita até 12. */
export const MAX_TABELAS_PRECO = 12;

/** Chave de mapeamento para a N-ésima tabela de preço (1-based). */
export const precoTabelaKey = (n: number): string => `precoTabela${n}`;

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
