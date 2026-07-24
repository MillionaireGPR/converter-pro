// Validacao real (Node puro, sem jsdom) do fix multi-aba Dute/Petrin/Levivan.
// Roda via: npx vite-node scripts/verify-multisheet-real.mjs
// (jsdom tem um bug de ambiente que faz XLSX.read nao reconhecer o zip do
// .xlsx quando rodado dentro do vitest -- ver PR/investigacao 22/07/2026.
// Node puro + vite-node evita isso e testa o MODULO REAL, nao uma copia.)
import { readFileSync } from 'fs';
import { runImportPipeline } from '../src/core/pipeline/importPipeline.ts';

const FILES = {
  Dute: 'C:\\Users\\Gabriel Pantoni\\Downloads\\Lista de produtos Dute 25-03.xlsx',
  Petrin: 'C:\\Users\\Gabriel Pantoni\\Downloads\\Lista de produtos Petrin 27-03.xlsx',
  Levivan: 'C:\\Users\\Gabriel Pantoni\\Downloads\\Lista de produtos Levivan 27-03.xlsx',
};

const toFile = (path) => {
  const buf = readFileSync(path);
  return new File([buf], path.split('\\').pop(), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

let falhas = 0;
const check = (nome, cond, detalhe = '') => {
  console.log(`  [${cond ? 'OK' : 'FALHA'}] ${nome}${!cond && detalhe ? ' -- ' + detalhe : ''}`);
  if (!cond) falhas++;
};

console.log('='.repeat(70));
console.log('DUTE (supplierName=Dute Toys) — deve ler as 3 abas');
console.log('='.repeat(70));
{
  const r = await runImportPipeline(toFile(FILES.Dute), { supplierName: 'Dute Toys' });
  const codigos = r.produtosNormalizados.map(p => p.codigoOriginal || p.codigo);
  check('total de produtos > 500 (antes só lia ~524 da 1a aba; agora +promo +prevenda)', r.produtosNormalizados.length > 500, `total=${r.produtosNormalizados.length}`);
  check('DTY0872 (aba principal) presente', codigos.includes('DTY0872'));
  check('DTP0012 (Itens promocionais) presente', codigos.includes('DTP0012'));
  check('DT10060 (Pré-venda) presente', codigos.includes('DT10060'));
  const p = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'DT10060');
  check('DT10060 preço correto (35)', !!p && Math.abs(p.precoBase - 35) < 0.01, `preco=${p?.precoBase}`);
}

console.log('\n' + '='.repeat(70));
console.log('DUTE (supplierName=Fornecedor Genérico XYZ) — regressão: só 1a aba');
console.log('='.repeat(70));
{
  const r = await runImportPipeline(toFile(FILES.Dute), { supplierName: 'Fornecedor Genérico XYZ' });
  const codigos = r.produtosNormalizados.map(p => p.codigoOriginal || p.codigo);
  check('DTY0872 (aba principal) presente', codigos.includes('DTY0872'));
  check('DTP0012 (promocional) AUSENTE — gate por fornecedor funcionando', !codigos.includes('DTP0012'));
}

console.log('\n' + '='.repeat(70));
console.log('PETRIN — deve ler as 3 abas');
console.log('='.repeat(70));
{
  const r = await runImportPipeline(toFile(FILES.Petrin), { supplierName: 'Petrin' });
  const codigos = r.produtosNormalizados.map(p => p.codigoOriginal || p.codigo);
  check('RD1318 (aba principal) presente', codigos.includes('RD1318'));
  check('RD1422 (Itens promocionais) presente', codigos.includes('RD1422'));
  check('RD1034 (Pré-venda) presente', codigos.includes('RD1034'));
}

console.log('\n' + '='.repeat(70));
console.log('LEVIVAN — deve ler as 3 abas (mesmo com "Itens promocionais" vazia)');
console.log('='.repeat(70));
{
  const r = await runImportPipeline(toFile(FILES.Levivan), { supplierName: 'Levivan' });
  const codigos = r.produtosNormalizados.map(p => p.codigoOriginal || p.codigo);
  check('LV1009 (aba principal) presente', codigos.includes('LV1009'));
  check('LV1078 (Pré-venda) presente', codigos.includes('LV1078'));
}

console.log('\n' + '='.repeat(70));
console.log('PETRIN 21-07 — aba "Pré-venda" SEM linha de cabeçalho própria');
console.log('(achado real 24/07/2026: export do cliente mudou e a aba de');
console.log('pré-venda passou a começar direto com dado -- sem isso, a aba');
console.log('inteira era descartada em silêncio: "não aparece no relatório")');
console.log('='.repeat(70));
{
  const path = 'C:\\Users\\Gabriel Pantoni\\Downloads\\Lista de produtos Petrin  21-07.xlsx';
  const r = await runImportPipeline(toFile(path), { supplierName: 'Petrin' });
  const codigos = r.produtosNormalizados.map(p => p.codigoOriginal || p.codigo);
  check('RD1519 (Itens de faturamento imediato) presente', codigos.includes('RD1519'));
  check('RD1422 (promoção) presente', codigos.includes('RD1422'));
  check('RD1802 (Pré-venda SEM cabeçalho) presente', codigos.includes('RD1802'));
  check('RD.1094 (aba "Planilha1", layout diferente) AUSENTE — segue ignorada', !codigos.includes('RD.1094'));
  const p = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'RD1802');
  check('RD1802 preço correto (5, não a qtd 198)', !!p && Math.abs(p.precoBase - 5) < 0.01, `preco=${p?.precoBase}`);
  check('RD1802 quantidadeCaixa correta (96, do CX/96)', p?.quantidadeCaixa === 96, `qtd=${p?.quantidadeCaixa}`);
}

console.log('\n' + '='.repeat(70));
console.log(falhas === 0 ? '✅ TODOS OS CHECKS PASSARAM' : `❌ ${falhas} FALHA(S)`);
console.log('='.repeat(70));
console.log('\n' + '='.repeat(70));
console.log('TAG ***PRE VENDA*** / ***PROMOCAO*** (reunião 24/07/2026)');
console.log('='.repeat(70));
{
  const petrinPath = 'C:/Users/Gabriel Pantoni/Downloads/Lista de produtos Petrin  21-07.xlsx';
  const r = await runImportPipeline(toFile(petrinPath), { supplierName: 'Petrin' });
  const preVenda = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'RD1802');
  check('RD1802 (Pré-venda) tem ***PRE VENDA*** no nome', /\*\*\*PRE VENDA\*\*\*/i.test(preVenda?.nome || ''), `nome=${preVenda?.nome}`);
  check('RD1802 bloqueiaDesconto=true', preVenda?.bloqueiaDesconto === true);
  const promo = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'RD1422');
  check('RD1422 (promoção) tem ***PROMOCAO*** no nome', /\*\*\*PROMOCAO\*\*\*/i.test(promo?.nome || ''), `nome=${promo?.nome}`);
  const principal = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'RD1519');
  check('RD1519 (aba principal) SEM tag nenhuma', !/\*\*\*/.test(principal?.nome || ''), `nome=${principal?.nome}`);
}
{
  const dutePath = 'C:/Users/Gabriel Pantoni/Downloads/Lista de produtos Dute 21-07.xlsx';
  const r = await runImportPipeline(toFile(dutePath), { supplierName: 'Dute Toys' });
  const preVenda = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'DT10247');
  check('DT10247 (Dute Pré-venda) tem ***PRE VENDA*** no nome', /\*\*\*PRE VENDA\*\*\*/i.test(preVenda?.nome || ''), `nome=${preVenda?.nome}`);
}
{
  const levivanPath = 'C:/Users/Gabriel Pantoni/Downloads/Lista de produtos Levivan 21-06.xlsx';
  const r = await runImportPipeline(toFile(levivanPath), { supplierName: 'Levivan' });
  const preVenda = r.produtosNormalizados.find(x => (x.codigoOriginal || x.codigo) === 'LV1083');
  check('LV1083 (Levivan Pré-venda) tem ***PRE VENDA*** no nome', /\*\*\*PRE VENDA\*\*\*/i.test(preVenda?.nome || ''), `nome=${preVenda?.nome}`);
}

console.log('\n' + '='.repeat(70));
console.log(falhas === 0 ? '✅ TODOS OS CHECKS PASSARAM' : `❌ ${falhas} FALHA(S)`);
console.log('='.repeat(70));
process.exit(falhas === 0 ? 0 : 1);
