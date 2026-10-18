/**
 * Versão que aparece no topo do conversor (selo "v295"). Mesmo padrão da Nunê
 * e do Central Pirralhos, pedido do Gabriel (17/10/2026): a partir de um print
 * do Josef ou da equipe, saber em qual versão a pessoa estava ("o print está
 * na v294, o conversor já está na v295 → faltou atualizar").
 *
 * Número = quantidade de commits do projeto no momento da entrega
 * (`git rev-list --count HEAD` + 1 para o commit que sobe a versão).
 * Manual de propósito: a Vercel clona o repositório raso, então contar commits
 * no build daria número errado. Toda entrega (tela OU motor de conversão):
 * subir este número e escrever a entrada em `src/data/novidades.ts` (o teste
 * quebra se esquecer).
 */
export const VERSAO = "295";
