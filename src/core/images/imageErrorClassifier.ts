// ===================================================================
// CLASSIFICADOR DE ERRO DE EXTRAÇÃO DE IMAGENS (reunião 22/07/2026)
// O cliente não deve ver stack trace / erro técnico cru ("cannot unpack
// non-iterable numpy.int32 object"). Este classificador traduz o erro
// bruto do backend em: (1) uma mensagem SIMPLES pro cliente, e (2) um
// CÓDIGO curto e estável que ele reporta ao suporte — e que aponta pra
// exatamente onde olhar no código-fonte (mapa abaixo).
//
// MAPA CÓDIGO → ONDE OLHAR:
//   IMG-GRID    → backend/image_extractor/cv_extractor.py
//                 (_detect_lines / _match_via_grid — detecção de grade/foto)
//   IMG-SRV     → infra Render (OOM/restart do servidor). Mitigar com
//                 "Cortar PDF" (catálogo menor) ou upgrade de RAM.
//   IMG-TIMEOUT → backend não concluiu no tempo — catálogo muito grande
//                 ou lento. Cortar PDF / investigar performance.
//   IMG-UPLOAD  → o arquivo não terminou de subir (navegador abortou o POST).
//                 Ver core/net/uploadTimeout.ts — prazo x banda do cliente.
//   IMG-GEN     → não classificado. Ver o "detalhe técnico" logado no
//                 console com esse código.
// ===================================================================

export interface ImageErrorInfo {
  /** Código curto reportável (ex: "IMG-GRID"). */
  code: string;
  /** Mensagem amigável pro cliente. */
  friendly: string;
  /** Erro técnico original (pra console/suporte, não pro cliente). */
  technical: string;
}

export function classifyImageError(raw: string): ImageErrorInfo {
  const technical = raw || 'erro desconhecido';
  const t = technical.toLowerCase();

  // Bug de forma do HoughLinesP / detecção de grade (cv_extractor).
  if (t.includes('unpack') || t.includes('numpy') || t.includes('int32') ||
      t.includes('houghlines') || t.includes('_detect_lines') || t.includes('_match_via')) {
    return {
      code: 'IMG-GRID',
      friendly: 'Não foi possível identificar as fotos neste catálogo. Os preços e produtos foram extraídos normalmente.',
      technical,
    };
  }

  // Servidor reiniciou / sem memória (catálogo grande no plano free).
  if (t.includes('reiniciou') || t.includes('not_found') || t.includes('memory') ||
      t.includes('512') || t.includes('paus') || t.includes('oom')) {
    return {
      code: 'IMG-SRV',
      friendly: 'O servidor não conseguiu processar as fotos deste catálogo (muito grande). Tente usar "Cortar PDF" para processar só as páginas necessárias.',
      technical,
    };
  }

  // Upload não chegou ao servidor (arquivo grande + link lento). Precisa vir
  // ANTES do timeout: o erro do navegador nesse caso é um abort, e cair no
  // genérico IMG-GEN foi o que escondeu a causa real do Dute/FORTAL em
  // 11/09/2026 — o servidor estava bem, o arquivo é que não subia inteiro.
  if (t.includes('upload') || t.includes('abort')) {
    return {
      code: 'IMG-UPLOAD',
      friendly: 'O catálogo não terminou de subir para o servidor (arquivo grande ou internet lenta), então as fotos não puderam ser captadas. Os preços e produtos foram extraídos normalmente. Tente de novo numa conexão melhor ou use "Cortar PDF".',
      technical,
    };
  }

  // Timeout de processamento.
  if (t.includes('timeout') || t.includes('não concluiu') || t.includes('nao concluiu')) {
    return {
      code: 'IMG-TIMEOUT',
      friendly: 'A captação de fotos demorou demais e foi interrompida. Tente "Cortar PDF" para reduzir o catálogo.',
      technical,
    };
  }

  return {
    code: 'IMG-GEN',
    friendly: 'A captação de fotos não funcionou neste catálogo. Os preços e produtos foram extraídos normalmente.',
    technical,
  };
}
