/**
 * O que mudou em cada versão, escrito para quem USA o conversor (Josef e a
 * equipe da Nunes) — não para quem programa. É o "resumo que iria pelo
 * WhatsApp", dentro da própria tela (Central de novidades, ícone ✨ no topo).
 *
 * REGRA: toda vez que `VERSAO` (src/lib/versao.ts) sobe, entra aqui uma
 * entrada com o MESMO número, no topo. `novidades.test.ts` quebra se esquecer.
 * Vale também para mudança só no motor de conversão (servidor), que não muda a
 * tela: é entrega, ganha versão e entrada aqui.
 * Escreva o que a pessoa vai ver de diferente e ONDE testar. Sem termo técnico.
 */
export type TipoNovidade = "novo" | "corrigido" | "ajustado";

export interface ItemNovidade {
  tipo: TipoNovidade;
  texto: string;
  /** Onde clicar / o que olhar para conferir. */
  testar?: string;
}

export interface Novidade {
  versao: number;
  /** AAAA-MM-DD */
  data: string;
  itens: ItemNovidade[];
}

/** Da mais nova para a mais antiga. */
export const NOVIDADES: Novidade[] = [
  {
    versao: 297,
    data: "2026-10-18",
    itens: [
      {
        tipo: "corrigido",
        texto: "Levivan: preços certos (antes vários saíam 9,75, que era o IPI), nomes certos (sem \"Obs.: (ST)…\" nem NCM no lugar do nome), caixa da bandeja (36 pçs) e sem código repetido em 2 linhas. \"DE R$ 19,00 POR R$ 11,90\" sai 11,90 com ***PROMOCAO***.",
        testar: "Converta o catálogo Levivan de 13/10 e confira LV1001 (pág. 4), LV1062/LV1063 (pág. 26) e LV1049 (pág. 8).",
      },
      {
        tipo: "ajustado",
        texto: "Produto com selo EM BREVE não sai mais na planilha, mesmo com preço impresso (vale para todos os fornecedores).",
        testar: "Levivan: LV1050 (pág. 8) e LV1056 (pág. 6) não devem estar na planilha.",
      },
    ],
  },
  {
    versao: 296,
    data: "2026-10-18",
    itens: [
      {
        tipo: "ajustado",
        texto: "Atualização de segurança da base do sistema. Nada muda no uso: telas, conversões e planilhas continuam iguais.",
      },
    ],
  },
  {
    versao: 295,
    data: "2026-10-17",
    itens: [
      {
        tipo: "novo",
        texto: "Selo da versão no topo da tela (ex.: v295). Ao mandar um print com problema, o número mostra em qual versão você estava.",
        testar: "Canto superior direito, ao lado do círculo NR.",
      },
      {
        tipo: "novo",
        texto: "Aviso de atualização: quando sai versão nova, aparece uma barra amarela piscando no topo e o selo vira \"Atualizar\". Um clique recarrega o conversor já na versão nova (não precisa de Ctrl+F5).",
      },
      {
        tipo: "novo",
        texto: "Central de novidades (ícone ✨): o que mudou em cada versão e como testar. O pontinho amarelo acende quando tem novidade que você ainda não viu.",
        testar: "Clique no ✨ ao lado do selo da versão.",
      },
    ],
  },
  {
    versao: 294,
    data: "2026-10-16",
    itens: [
      {
        tipo: "corrigido",
        texto: "Neo Festas: produto com a tarja ESGOTADO não sai mais na planilha (eram 161). O \"EM BREVE\" que aparecia no produto vizinho da tarja também saiu.",
        testar: "Converta a Neo de 13/10 e procure 135801, 135810 e 135860 (pág. 90): não devem estar na planilha.",
      },
      {
        tipo: "corrigido",
        texto: "Neo Festas: preço do pacote como está impresso (ex.: balão translúcido 10\" sai R$ 34,90, e não 0,70) e caixa em pacotes por kit (\"Kit c/04 pct.\" → Cx c/ 4).",
        testar: "Neo: 131296 (pág. 71) e 150266 (pág. 7).",
      },
      {
        tipo: "ajustado",
        texto: "***CORES*** só em produto com mais de uma cor. O nome sai sem a cor, e a cor vai para Informações adicionais. Vale para a Neo e a VAESO.",
        testar: "Neo: fitilho holográfico (pág. 71). VAESO: pote hermético dosador.",
      },
    ],
  },
  {
    versao: 293,
    data: "2026-10-16",
    itens: [
      {
        tipo: "corrigido",
        texto: "BM36 / World Classic: voltaram os 575 produtos que não saíam (quase todos os WC). \"(PROM50%)\" no nome agora vira ***PROMOCAO***, e o 439890 sai com o código impresso.",
        testar: "Converta o CATALAGO GERAL 01.10 e procure WC4010046 (pág. 30) e BM361601 (pág. 7).",
      },
      {
        tipo: "corrigido",
        texto: "Goal: voltaram os 16 produtos com \"Preço\" sem o R$ que ficavam de fora (kits de coelhos, ursos, boneca…).",
        testar: "Converta a tabela Goal de 08/10 e procure GK3733 (pág. 4).",
      },
    ],
  },
  {
    versao: 292,
    data: "2026-10-16",
    itens: [
      {
        tipo: "corrigido",
        texto: "Dute: o catálogo de 13/10 voltou a gerar a planilha. Antes saía sem planilha e com 50 fotos \"igo.jpg\" iguais.",
        testar: "Converta o Catálogo dutetoys 13-10.",
      },
    ],
  },
  {
    versao: 291,
    data: "2026-10-16",
    itens: [
      {
        tipo: "corrigido",
        texto: "Neo Festas: a foto vem do próprio cartão do produto (antes pegava a do cartão vizinho). Quando o cartão tem várias cores, cada código fica com a foto da cor da sua bolinha. Nenhum produto ficou sem foto.",
        testar: "Neo: colares e saias (pág. 41), cortinas (pág. 90).",
      },
    ],
  },
  {
    versao: 290,
    data: "2026-10-16",
    itens: [
      {
        tipo: "ajustado",
        texto: "MOMENT: caixa inner e master lado a lado em Informações adicionais (\"Cx inner c/ 12 unidades | Cx master c/ 96 unidades\"), sem precisar abrir o Jaweb.",
        testar: "Converta a planilha MOMENT e veja a coluna Informações adicionais.",
      },
    ],
  },
  {
    versao: 288,
    data: "2026-10-13",
    itens: [
      {
        tipo: "corrigido",
        texto: "Fotos do Teste 10: GIRA Malas, Papelaria e Decoração, Goal, Lila, Tuka, Neo e Dute (produtos que ficavam sem foto ou com a foto de outro produto).",
        testar: "Reconverta os catálogos do Teste 10 e confira as fotos citadas no laudo.",
      },
    ],
  },
  {
    versao: 287,
    data: "2026-10-13",
    itens: [
      {
        tipo: "corrigido",
        texto: "Dados do Teste 10: nomes, caixas, preço de pacote, IPI e códigos repetidos (Neo, FORTAL, Tuka, VAESO e outros).",
        testar: "Reconverta os catálogos do Teste 10 e confira os itens do laudo.",
      },
    ],
  },
  {
    versao: 285,
    data: "2026-10-05",
    itens: [
      {
        tipo: "corrigido",
        texto: "Fotos do Teste 9: FOLIA sem a moldura azul e sem pedaço da etiqueta; Dute sem o produto EM BREVE vizinho; Neo e Tuka com a foto do lado certo; Dagia sem decoração de fundo.",
        testar: "Converta a FOLIA Brinquedos e veja se as fotos saem limpas.",
      },
    ],
  },
  {
    versao: 284,
    data: "2026-10-04",
    itens: [
      {
        tipo: "corrigido",
        texto: "Dados do Teste 9: nomes da GIRA, Goal e Tuka, produtos que sumiam da GIRA Utilidades, ***PROMOCAO*** da FORTAL e da Lila, preços da Neo.",
        testar: "Converta a GIRA Utilidades e confira os nomes.",
      },
    ],
  },
];
