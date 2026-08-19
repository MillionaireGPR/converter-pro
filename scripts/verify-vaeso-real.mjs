// Validacao real (Node puro, sem jsdom) do fornecedor VAESO.
// Roda via: npx vite-node scripts/verify-vaeso-real.mjs
//
// Contexto (19/08/2026): a Michele/Josef reportaram que a "quantidade na
// caixa" saia 1 para TODOS os itens da VAESO. Causa: a coluna do fornecedor
// chama "Caixa master" e o match de alias e exato ou por prefixo -- 'caixa'
// sozinho nao alcanca 'caixamaster' (5/11 = 45%, abaixo do corte de 60%) e
// 'masterbox'/'embmaster' nao compartilham prefixo. Resultado: caia no
// default 1 silenciosamente.
import { readFileSync } from 'fs';
import { runImportPipeline } from '../src/core/pipeline/importPipeline.ts';

const FILE = 'C:/Users/Gabriel Pantoni/Downloads/Base Produtos - TABELA PREÇOS - AGOSTO 2026 _FEIRA corrigido.xlsx';

const toFile = (path) => {
  const buf = readFileSync(path);
  return new File([buf], path.split('/').pop(), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

let falhas = 0;
const check = (nome, cond, detalhe = '') => {
  console.log(`  [${cond ? 'OK' : 'FALHA'}] ${nome}${!cond && detalhe ? ' -- ' + detalhe : ''}`);
  if (!cond) falhas++;
};

console.log('='.repeat(70));
console.log('VAESO — quantidade da caixa vem da coluna "Caixa master"');
console.log('='.repeat(70));
{
  const r = await runImportPipeline(toFile(FILE), { supplierName: 'VAESO' });
  const byCod = (c) => r.produtosNormalizados.find(p => (p.codigoOriginal || p.codigo) === c);

  check('178 produtos importados', r.produtosNormalizados.length === 178, `total=${r.produtosNormalizados.length}`);

  const ps = byCod('PS0450');
  check('PS0450 presente', !!ps);
  check('PS0450 quantidadeCaixa = 24 (era 1 antes do fix)', ps?.quantidadeCaixa === 24, `qtd=${ps?.quantidadeCaixa}`);
  check('PS0450 preço = 12.99 (coluna "Preço de Tabela")', Math.abs((ps?.precoBase ?? 0) - 12.99) < 0.01, `preco=${ps?.precoBase}`);

  const ba = byCod('BA0135');
  check('BA0135 quantidadeCaixa = 24', ba?.quantidadeCaixa === 24, `qtd=${ba?.quantidadeCaixa}`);

  // Trava principal: NENHUM item pode sair com o default 1 (o sintoma relatado).
  const comQtd1 = r.produtosNormalizados.filter(p => p.quantidadeCaixa === 1);
  check('nenhum item com quantidadeCaixa=1 (sintoma original)', comQtd1.length === 0,
        `${comQtd1.length} itens ainda com 1`);
}

console.log('\n' + '='.repeat(70));
console.log(falhas === 0 ? '✅ TODOS OS CHECKS PASSARAM' : `❌ ${falhas} FALHA(S)`);
console.log('='.repeat(70));
process.exit(falhas === 0 ? 0 : 1);
