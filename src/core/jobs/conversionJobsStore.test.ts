/**
 * Trava o comportamento que o Josef pediu (11/09/2026): sair da tela de
 * conversão NÃO pode apagar os catálogos que ainda estão convertendo.
 * "eu terminei da Levivan, fui ver a exportação e os catálogos que estavam
 * carregando sumiram — a gente consegue deixar rodando em segundo plano e
 * voltar nessa mesma tela?"
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  adicionarJob, atualizarJobStore, mapearJobs, removerJob,
  listarJobs, contarEmAndamento, __resetJobs, type CatalogJob,
} from './conversionJobsStore';

const job = (id: string, status: CatalogJob['status'] = 'processing'): CatalogJob => ({
  id,
  file: { name: `${id}.pdf`, size: 1 } as File,
  fornecedorSelecionado: 'f1',
  novoFornecedorNome: '',
  regrasNovoFornecedor: '',
  mappingsNovoFornecedor: {},
  tipoArquivo: 'pdf',
  fornecedorNome: 'DUTE',
  status,
  progress: 10,
  progressMsg: 'Preparando arquivo...',
  startedAt: 0,
  elapsedSec: 0,
  finalElapsedSec: null,
  errorMsg: null,
  resultData: null,
  importMeta: null,
  imageResult: null,
  isZipping: false,
});

beforeEach(() => __resetJobs());

describe('fila de conversões fora do React', () => {
  it('a fila sobrevive a quem a estava exibindo — é estado de módulo', () => {
    adicionarJob(job('a'));
    // Nenhum componente montado aqui: se a fila dependesse do React, este
    // estado já teria ido embora junto com a tela.
    expect(listarJobs()).toHaveLength(1);
    expect(listarJobs()[0].id).toBe('a');
  });

  it('job mais novo entra no topo', () => {
    adicionarJob(job('a'));
    adicionarJob(job('b'));
    expect(listarJobs().map(j => j.id)).toEqual(['b', 'a']);
  });

  it('atualizar um job não toca nos outros', () => {
    adicionarJob(job('a'));
    adicionarJob(job('b'));
    atualizarJobStore('a', { progress: 70 });
    expect(listarJobs().find(j => j.id === 'a')!.progress).toBe(70);
    expect(listarJobs().find(j => j.id === 'b')!.progress).toBe(10);
  });

  it('cada mudança gera um array NOVO — sem isso o React não re-renderiza', () => {
    adicionarJob(job('a'));
    const antes = listarJobs();
    atualizarJobStore('a', { progress: 99 });
    expect(listarJobs()).not.toBe(antes);
  });

  it('leitura sem mudança devolve o MESMO array — senão useSyncExternalStore entra em laço', () => {
    adicionarJob(job('a'));
    expect(listarJobs()).toBe(listarJobs());
  });

  it('mapearJobs calcula a partir do valor anterior (o cronômetro depende disso)', () => {
    adicionarJob(job('a'));
    mapearJobs(j => ({ ...j, progress: j.progress + 5 }));
    expect(listarJobs()[0].progress).toBe(15);
  });

  it('conta só o que ainda está convertendo — é o que o aviso global mostra', () => {
    adicionarJob(job('a', 'processing'));
    adicionarJob(job('b', 'done'));
    adicionarJob(job('c', 'error'));
    adicionarJob(job('d', 'processing'));
    expect(contarEmAndamento()).toBe(2);
  });

  it('remover tira da fila', () => {
    adicionarJob(job('a'));
    removerJob('a');
    expect(listarJobs()).toHaveLength(0);
  });
});
