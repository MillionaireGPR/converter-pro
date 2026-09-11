/**
 * Fila de conversões viva FORA do React (11/09/2026).
 *
 * A fila morava em `useState` dentro de ConversaoProdutos. Sair da tela
 * desmontava o componente e o estado ia junto: o trabalho continuava rodando
 * no servidor, mas a tela de acompanhamento voltava vazia e o cliente não
 * tinha como saber se ainda estava convertendo. O Josef relatou assim:
 * "eu terminei da Levivan, fui ver a exportação e os catálogos que estavam
 * carregando sumiram — a gente consegue deixar rodando em segundo plano e
 * voltar nessa mesma tela?".
 *
 * Aqui o estado é de MÓDULO, então ele vive enquanto a aba viver, e a tela
 * vira só uma leitura dele. Não persiste em disco de propósito: um job
 * carrega o `File` que o cliente escolheu, e `File` não sobrevive a um
 * recarregamento de página — prometer isso no localStorage devolveria um job
 * fantasma, sem arquivo, impossível de continuar.
 */
import { useSyncExternalStore } from 'react';
import type { ImportMetadata } from '../types/productPipeline';
import type { ResultadoExtracaoImagens } from '../images/imageTypes';
import type { ColumnMappings } from '../supplierRules/applyColumnMappings';

export interface CatalogJob {
  id: string;
  file: File;
  // Snapshot do formulário no momento em que o job foi criado — o formulário
  // é limpo e reaproveitado pro próximo catálogo logo em seguida, então o job
  // não pode depender do estado do componente.
  fornecedorSelecionado: string; // id do fornecedor ou 'novo'
  novoFornecedorNome: string;
  regrasNovoFornecedor: string;
  mappingsNovoFornecedor: ColumnMappings;
  tipoArquivo: string; // só decorativo (ícone do painel)
  fornecedorNome: string;
  status: 'processing' | 'done' | 'error';
  progress: number;
  progressMsg: string;
  startedAt: number;
  elapsedSec: number;
  finalElapsedSec: number | null;
  errorMsg: string | null;
  resultData: {
    total: number; ok: number; pendentes: number; erros: number;
    duplicados: number; fileName: string; fornNome: string;
  } | null;
  importMeta: ImportMetadata | null;
  imageResult: ResultadoExtracaoImagens | null;
  isZipping: boolean;
}

let jobs: CatalogJob[] = [];
const listeners = new Set<() => void>();

const emitir = () => listeners.forEach(l => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** Snapshot estável: `useSyncExternalStore` compara por identidade e entraria
 *  em laço infinito se cada leitura devolvesse um array novo. */
const getSnapshot = () => jobs;

export const listarJobs = (): CatalogJob[] => jobs;

export const adicionarJob = (job: CatalogJob): void => {
  jobs = [job, ...jobs];
  emitir();
};

export const atualizarJobStore = (id: string, patch: Partial<CatalogJob>): void => {
  jobs = jobs.map(j => (j.id === id ? { ...j, ...patch } : j));
  emitir();
};

/** Patch calculado a partir do job atual (ex.: cronômetro, que depende do
 *  valor anterior) sem que o chamador precise reler a lista. */
export const mapearJobs = (fn: (j: CatalogJob) => CatalogJob): void => {
  jobs = jobs.map(fn);
  emitir();
};

export const removerJob = (id: string): void => {
  jobs = jobs.filter(j => j.id !== id);
  emitir();
};

/** Quantos catálogos ainda estão convertendo — é o que o aviso global mostra
 *  nas outras telas pra que o caminho de volta exista. */
export const contarEmAndamento = (lista: CatalogJob[] = jobs): number =>
  lista.filter(j => j.status === 'processing').length;

/** Assina a fila. Toda tela que lê jobs passa por aqui. */
export const useConversionJobs = (): CatalogJob[] =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** Só para testes: devolve a fila ao estado inicial. */
export const __resetJobs = (): void => {
  jobs = [];
  emitir();
};
