// ===================================================================
// REGISTRY DE SUPPLIER ADAPTERS
// Centraliza todos os adapters e fornece detecção automática.
// ===================================================================

import { SupplierAdapter, SupplierDetectionResult } from './types';
import { lilaHomeAdapter } from './lila-home';
import { nixAdapter } from './nix';
import { bm36Adapter } from './bm36';
import { neoFestasAdapter } from './neo-festas';
import { goalKidsAdapter } from './goal-kids';
import { clinkAdapter } from './clink';
import { momentAdapter } from './moment';
import { flashAdapter } from './flash';
import { genericAdapter } from './generic';

/** Lista completa de adapters registrados (ordem importa para detecção) */
const ADAPTERS: SupplierAdapter[] = [
  lilaHomeAdapter,
  nixAdapter,
  bm36Adapter,
  neoFestasAdapter,
  goalKidsAdapter,
  clinkAdapter,
  momentAdapter,
  flashAdapter,
];

/** Busca um adapter pelo ID ou nome (case-insensitive) */
export const getAdapterById = (idOrName: string): SupplierAdapter | undefined => {
  if (!idOrName) return undefined;
  const search = idOrName.toLowerCase().trim();
  return ADAPTERS.find(a =>
    a.id === search ||
    a.nome.toLowerCase() === search ||
    a.aliases.some(alias => alias.toLowerCase() === search)
  );
};

/** Retorna o adapter genérico (fallback) */
export const getGenericAdapter = (): SupplierAdapter => genericAdapter;

/** Retorna a lista de todos os adapters registrados (sem o genérico) */
export const getAllAdapters = (): SupplierAdapter[] => [...ADAPTERS];

/**
 * Detecta automaticamente o fornecedor a partir de:
 * 1. Nome encontrado no documento
 * 2. Padrões visuais/textuais
 * 3. Prefixos de código
 * 4. Estrutura repetitiva
 *
 * Retorna o adapter com maior confiança, ou o genérico se nenhum bater.
 */
export const detectSupplier = (
  textoAmostra: string,
  headers?: string[],
  codigosAmostra?: string[],
  nomeArquivo?: string
): SupplierDetectionResult => {

  const scores: { adapter: SupplierAdapter; score: number; evidencias: string[]; metodo: SupplierDetectionResult['metodo'] }[] = [];

  for (const adapter of ADAPTERS) {
    let score = 0;
    const evidencias: string[] = [];
    let metodo: SupplierDetectionResult['metodo'] = 'padrao-visual';

    // 0. Detecção por nome do arquivo
    if (nomeArquivo) {
      const fileNameLower = nomeArquivo.toLowerCase();
      const allNames = [adapter.nome, ...adapter.aliases];
      for (const name of allNames) {
        if (fileNameLower.includes(name.toLowerCase())) {
          score += 60;
          evidencias.push(`Fornecedor identificado no nome do arquivo: "${nomeArquivo}"`);
          metodo = 'nome';
        }
      }
    }

    // 1. Detecção por nome/alias no texto
    const allNames = [adapter.nome, ...adapter.aliases];
    for (const name of allNames) {
      if (name.length >= 3) {
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
        if (regex.test(textoAmostra)) {
          score += 50;
          evidencias.push(`Nome "${name}" encontrado no texto`);
          metodo = 'nome';
        }
      }
    }

    // 2. Detecção por padrões visuais/textuais
    for (const pattern of adapter.detectionPatterns) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(escapeRegex(pattern), 'i');
      if (regex.test(textoAmostra)) {
        score += 20;
        evidencias.push(`Padrão "${String(pattern)}" detectado`);
        if (metodo !== 'nome') metodo = 'padrao-visual';
      }
    }

    // 3. Detecção por prefixo de código
    if (adapter.codigoPattern && codigosAmostra && codigosAmostra.length > 0) {
      const matches = codigosAmostra.filter(c => adapter.codigoPattern!.test(c));
      if (matches.length > 0) {
        const ratio = matches.length / codigosAmostra.length;
        score += Math.round(ratio * 30);
        evidencias.push(`${matches.length}/${codigosAmostra.length} códigos batem com padrão ${adapter.codigoPattern}`);
        if (metodo !== 'nome') metodo = 'prefixo-codigo';
      }
    }

    // 4. Detecção por headers (se disponíveis)
    if (headers && headers.length > 0) {
      const headerText = headers.join(' ').toLowerCase();
      const aliasHits = Object.values(adapter.fieldAliases)
        .flat()
        .filter(alias => alias && headerText.includes(alias.toLowerCase()));
      if (aliasHits.length >= 3) {
        score += aliasHits.length * 3;
        evidencias.push(`${aliasHits.length} aliases de campo encontrados nos headers`);
        if (metodo !== 'nome') metodo = 'estrutura';
      }
    }

    if (score > 0) {
      scores.push({ adapter, score, evidencias, metodo });
    }
  }

  // Ordena por score decrescente
  scores.sort((a, b) => b.score - a.score);

  if (scores.length > 0 && scores[0].score >= 20) {
    const best = scores[0];
    return {
      adapter: best.adapter,
      confianca: Math.min(best.score, 100),
      metodo: best.metodo,
      evidencias: best.evidencias,
    };
  }

  // Nenhum adapter detectado → retorna genérico
  return {
    adapter: genericAdapter,
    confianca: 0,
    metodo: 'manual',
    evidencias: ['Nenhum fornecedor identificado automaticamente'],
  };
};

/** Escapa caracteres especiais de regex */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
