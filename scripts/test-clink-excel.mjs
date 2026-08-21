/**
 * Teste local dos Excels Clink/Flash/Moment.
 * Simula a pipeline frontend sem browser: lê xlsx, detecta headers, extrai produtos,
 * verifica qualidade de campos. NÃO detecta cores (requer DOMParser do browser).
 *
 * Uso: node scripts/test-clink-excel.mjs
 */
import XLSX from 'xlsx';
import JSZip from 'jszip';
import { readFileSync } from 'fs';

const BASE = 'C:/Users/Gabriel Pantoni/OneDrive/Desktop/IQC PERSONALITE/Clientes e Projetos/MICHELLE RIBEIRO NUNES DUARTE/Conversor de Documentos/Catalogos modelos de Fornecedor';

const FILES = {
  CLINK:  `${BASE}/Planilha EXCEL CLINK.xlsx`,
  FLASH:  `${BASE}/Planilha EXCEL FLASHGOODS.xlsx`,
  MOMENT: `${BASE}/Planilha EXCEL MOMENT.xlsx`,
};

// Alias map para campos críticos (espelha CLINK_FAMILY_FIELD_ALIASES)
const ALIASES = {
  codigo:    ['código', 'codigo', 'cod', 'ref', 'sku', 'id'],
  descricao: ['descr compl', 'descricao', 'descrição', 'nome', 'produto', 'desc'],
  preco:     ['p.venda', 'pvenda', 'preco', 'preço', 'valor', 'custo'],
  qtd:       ['qtd caixa inner', 'qtd caixa', 'qtdcaixa', 'caixa', 'cx', 'master'],
  previsao:  ['previsão', 'previsao', 'status'],
};

function normalizeKey(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findCol(headers, aliases) {
  // priority order: first alias wins
  for (const alias of aliases) {
    const norm = normalizeKey(alias);
    const idx = headers.findIndex(h => normalizeKey(h) === norm);
    if (idx >= 0) return idx;
  }
  return -1;
}

function findHeaderRow(rawRows) {
  // Score: count how many ALIASES columns match
  let bestScore = 0, bestIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i].map(String);
    let score = 0;
    for (const group of Object.values(ALIASES)) {
      for (const alias of group) {
        if (row.some(c => normalizeKey(c) === normalizeKey(alias))) {
          score++;
          break;
        }
      }
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function extractPrice(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  const m = String(raw).replace(',', '.').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

async function testFile(name, path) {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  ${name}  —  ${path.split('/').pop()}`);
  console.log('═'.repeat(65));

  let buf;
  try { buf = readFileSync(path); }
  catch(e) { console.log('  [SKIP] Arquivo não encontrado'); return; }

  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Raw rows para detecção de header
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerIdx = findHeaderRow(rawRows);
  const headers = rawRows[headerIdx].map(String);

  console.log(`  Header detectado na linha ${headerIdx + 1}: ${headers.filter(Boolean).join(' | ')}`);

  // Colunas
  const iCodigo   = findCol(headers, ALIASES.codigo);
  const iDescr    = findCol(headers, ALIASES.descricao);
  const iPreco    = findCol(headers, ALIASES.preco);
  const iQtd      = findCol(headers, ALIASES.qtd);
  const iPrevisao = findCol(headers, ALIASES.previsao);

  console.log(`  Colunas → codigo=${iCodigo} descr=${iDescr} preco=${iPreco} qtd=${iQtd} previsao=${iPrevisao}`);

  const dataRows = rawRows.slice(headerIdx + 1).filter(row =>
    row.some(c => c !== '' && c !== null && c !== undefined)
  );

  let semCodigo = 0, semPreco = 0, semDescr = 0, semQtd = 0;
  let estoqueTotal = 0, prontoEntrega = 0, previsaoFutura = 0;
  let precoMin = Infinity, precoMax = 0;
  const amostras = [];

  for (const row of dataRows) {
    const codigo  = iCodigo  >= 0 ? String(row[iCodigo]  || '').trim() : '';
    const descr   = iDescr   >= 0 ? String(row[iDescr]   || '').trim() : '';
    const precoRaw= iPreco   >= 0 ? row[iPreco] : null;
    const preco   = extractPrice(precoRaw);
    const qtdRaw  = iQtd     >= 0 ? row[iQtd] : null;
    const qtd     = qtdRaw !== null && qtdRaw !== '' ? parseInt(String(qtdRaw)) : null;
    const prev    = iPrevisao >= 0 ? String(row[iPrevisao] || '').trim() : '';

    if (!codigo) { semCodigo++; continue; } // Skip linhas sem código = ruído

    if (!preco) semPreco++;
    if (!descr) semDescr++;
    if (!qtd)   semQtd++;

    if (preco) {
      precoMin = Math.min(precoMin, preco);
      precoMax = Math.max(precoMax, preco);
    }

    if (/pronta entrega/i.test(prev)) prontoEntrega++;
    else if (prev) previsaoFutura++;
    estoqueTotal++;

    if (amostras.length < 5) {
      amostras.push({ codigo, descr: descr.slice(0, 40), preco, qtd, prev: prev.slice(0, 20) });
    }
  }

  const total = estoqueTotal;
  console.log(`\n  Total produtos com código: ${total}`);
  console.log(`  Sem preço: ${semPreco} (${((semPreco/total)*100).toFixed(1)}%)`);
  console.log(`  Sem descrição: ${semDescr} (${((semDescr/total)*100).toFixed(1)}%)`);
  console.log(`  Sem qtd caixa: ${semQtd} (${((semQtd/total)*100).toFixed(1)}%)`);
  console.log(`  Pronto entrega: ${prontoEntrega} | Previsão futura: ${previsaoFutura}`);
  if (precoMin !== Infinity) {
    console.log(`  Preço: min=R$${precoMin.toFixed(2)} max=R$${precoMax.toFixed(2)}`);
  }

  console.log(`\n  Amostra (5 primeiros):`);
  console.log(`  ${'Código'.padEnd(10)} ${'Preço'.padStart(8)}  ${'Qtd'.padStart(4)}  ${'Descrição'.padEnd(40)}  Prev`);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(8)}  ${'─'.repeat(4)}  ${'─'.repeat(40)}  ${'─'.repeat(20)}`);
  for (const p of amostras) {
    console.log(
      `  ${p.codigo.padEnd(10)} ${p.preco != null ? `R$${p.preco.toFixed(2)}`.padStart(8) : '(s/preço)'}  ${String(p.qtd ?? '?').padStart(4)}  ${p.descr.padEnd(40)}  ${p.prev}`
    );
  }

  // Verifica campos críticos
  const erros = [];
  if (iCodigo < 0)  erros.push('❌ Coluna CÓDIGO não encontrada');
  if (iDescr < 0)   erros.push('❌ Coluna DESCRIÇÃO não encontrada');
  if (iPreco < 0)   erros.push('❌ Coluna PREÇO não encontrada');
  if (semPreco / total > 0.05) erros.push(`❌ ${semPreco}/${total} (${((semPreco/total)*100).toFixed(0)}%) SEM PREÇO — acima de 5%`);
  if (semCodigo > 50) erros.push(`⚠️  ${semCodigo} linhas ignoradas por ausência de código (ruído normal?)`);
  if (name === 'MOMENT' && findCol(headers, ['qtd caixa inner']) < 0) {
    erros.push('❌ MOMENT: coluna "Qtd Caixa inner" não encontrada — múltiplo estará errado!');
  }

  if (erros.length === 0) {
    console.log('\n  ✅ Qualidade OK');
  } else {
    for (const e of erros) console.log(`\n  ${e}`);
  }

  // Para Moment, verifica se "Qtd Caixa inner" é usado (col H)
  if (name === 'MOMENT') {
    const iInner = findCol(headers, ['qtd caixa inner']);
    const iOuter = findCol(headers, ['qtd caixa']);
    if (iInner >= 0 && iOuter >= 0) {
      const sample = dataRows.slice(0, 5).map(r => ({
        inner: r[iInner], outer: r[iOuter]
      }));
      console.log('\n  MOMENT — Qtd Caixa inner vs outer (primeiros 5):');
      for (const s of sample) console.log(`    inner=${s.inner}  outer=${s.outer}`);
      console.log('  → Múltiplo de venda deve usar "inner" (menor, para abrir caixa)');
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log('='.repeat(65));
console.log('  TESTE LOCAL — Excels Grupo Clink');
console.log('='.repeat(65));

for (const [name, path] of Object.entries(FILES)) {
  await testFile(name, path);
}

console.log('\n' + '─'.repeat(65));
console.log('  ⚠️  Cores de fonte (Promocional/Preço Fixo) NÃO testadas aqui.');
console.log('  Para validar cores → abrir no Vercel e enviar os arquivos.');
console.log('─'.repeat(65));
