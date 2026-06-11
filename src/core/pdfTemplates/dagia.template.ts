import { PdfTemplate } from './types';

/**
 * Template de PDF para DAGIA (catálogo 25-03-2026 validado).
 *
 * PROBLEMA OBSERVADO: O catálogo DAGIA tem layout que MUDA por página
 * (grid 2 produtos por página, texto em colunas escalonadas). Sem
 * blockExtractor explícito, o parser genérico estava FUNDINDO produtos
 * consecutivos (ex: "DXP1 + DXP2" virava 1 produto poluído).
 *
 * SOLUÇÃO: blockExtractor com lookahead em qualquer prefixo DAGIA conhecido.
 * Famílias confirmadas no catálogo real:
 *   - DXPD (mais longo, vem antes pra alternation matching correto)
 *   - DXP, DZ, DPB, DCM, DS, DM, DV, LHSP, LX, e CF<N>/L<N>
 *
 * Padrão de cada bloco no PDF:
 *   <CODIGO> <NOME COMPLETO> CX C/<N>(Jgs|Pçs) <DIMENSÕES> R$ <PREÇO>
 *
 * Exemplo: "DXP24 Xicara C/ Pires Opalina 190 ml C/12 Pçs - 8cm Larg
 *          7cm Alt - Jgs CX Presente CX C/12Jgs R$ 50,63"
 */
export const dagiaTemplate: PdfTemplate = {
  supplierId: 'dagia',
  supplierName: 'Dagia',
  identificationPatterns: [
    'DAGIA',
    'Dagia',
    /\bDXP\d+\b/i,
    /\bDXPD\d+\b/i,
    /\bDZ\d+\b/i,
    /\bDPB\d+\b/i,
  ],
  minConfidence: 25,

  // Separador de blocos: início de cada produto = prefixo DAGIA + dígitos.
  // IMPORTANTE: DXPD listado ANTES de DXP no alternation porque regex faz
  // greedy left-to-right e queremos casar DXPD53 como uma unidade.
  // Word boundary \b evita match dentro de palavras (ex: "produto").
  blockExtractor: /(?=\b(?:DXPD|DXP|DZ|DPB|DCM|DS|DM|DV|LHSP|LX|CF)\d+)/i,

  fieldExtractors: {
    // Código: qualquer prefixo DAGIA seguido por dígitos (e opcional /L\d+ pra CF)
    codigo: /\b((?:DXPD|DXP|DZ|DPB|DCM|DS|DM|DV|LHSP|LX|CF)\d+(?:[A-Z]?\/L\d+)?)/i,

    // Descrição: tudo entre o código e o primeiro marcador de fim (CX C/, R$, NCM)
    // Captura múltiplas linhas (DOTALL via /s flag) — necessário porque o texto
    // do PDF vem com quebras de linha entre atributos.
    descricao: /(?:DXPD|DXP|DZ|DPB|DCM|DS|DM|DV|LHSP|LX|CF)\d+(?:[A-Z]?\/L\d+)?\s+(.+?)(?=\s*(?:CX\s*C\/|R\$|NCM|IPI|$))/is,

    // Preço: R$ XX,XX ou R$ XXX.XX (formato BR — DECIMAIS OBRIGATÓRIOS).
    // Versão anterior aceitava "R$ 12" sem decimais e capturava lixo de
    // outros pontos do texto (ex: contagem "R$ 12" virando preço quando o
    // produto real vinha marcado como "EM BREVE..."). Decimais obrigatórios
    // evitam falso positivo.
    preco: /R\$\s*(\d{1,4}(?:\.\d{3})*[.,]\d{2})/i,

    // Quantidade caixa REAL = "CX C/N Jgs" (jogos por caixa de transporte).
    //
    // BUG anterior (até 09/06/2026): regex aceitava também "C/N Pçs" do NOME
    // do produto (ex: "Copo 458 ml C/6 Pçs"). O primeiro match (do nome)
    // ganhava, capturando 6 em vez do "CX C/8Jgs" real da etiqueta.
    //
    // Fix: EXIGE prefixo "CX". Sem CX, defaultQuantidadeCaixa=1 entra.
    // Validado contra LX15016 (real CX=8, nome diz "C/6 Pçs") e DXP25
    // (real CX=8, nome diz "C/12 Pçs").
    quantidadeCaixa: /CX\s*C\/(\d{1,3})\s*(?:Jgs|Jogos|P[cç]s|Pecas|Un)?/i,

    // NCM: NCM XXXX.XX.XX ou só XXXX.XX.XX
    ncm: /(?:NCM[:\s]*)?(\d{4}\.?\d{2}\.?\d{2})/i,

    // IPI: NN% ou IPI: NN
    ipi: /(?:IPI[:\s]*)?(\d{1,2}(?:[.,]\d+)?)\s*%/i,
  },
};
