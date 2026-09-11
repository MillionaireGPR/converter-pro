/**
 * O caminho de volta aos carregamentos (pedido do Josef, 11/09/2026).
 * Testa o que ele descreveu: estar em OUTRA tela e ainda assim conseguir
 * voltar para os catálogos que continuam convertendo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ConversoesEmAndamento } from './ConversoesEmAndamento';
import { adicionarJob, __resetJobs, type CatalogJob } from '@/core/jobs/conversionJobsStore';

const job = (id: string, forn: string, status: CatalogJob['status'] = 'processing'): CatalogJob => ({
  id,
  file: { name: `${id}.pdf`, size: 1 } as File,
  fornecedorSelecionado: 'f1',
  novoFornecedorNome: '',
  regrasNovoFornecedor: '',
  mappingsNovoFornecedor: {},
  tipoArquivo: 'pdf',
  fornecedorNome: forn,
  status,
  progress: 10,
  progressMsg: '',
  startedAt: 0,
  elapsedSec: 0,
  finalElapsedSec: null,
  errorMsg: null,
  resultData: null,
  importMeta: null,
  imageResult: null,
  isZipping: false,
});

function Sonda() {
  return <span data-testid="rota">{useLocation().pathname}</span>;
}

const montar = (rotaInicial: string) =>
  render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <Sonda />
      <ConversoesEmAndamento />
      <Routes><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => __resetJobs());

describe('ConversoesEmAndamento', () => {
  it('não aparece quando nada está convertendo', () => {
    montar('/exportacoes');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('aparece em outra tela enquanto um catálogo converte', () => {
    adicionarJob(job('a', 'DUTE'));
    montar('/exportacoes');
    expect(screen.getByText('1 catálogo convertendo')).toBeTruthy();
    expect(screen.getByText(/DUTE/)).toBeTruthy();
  });

  it('conta vários e resume os nomes', () => {
    adicionarJob(job('a', 'DUTE'));
    adicionarJob(job('b', 'PETRIN'));
    adicionarJob(job('c', 'LEVIVAN'));
    montar('/base');
    expect(screen.getByText('3 catálogos convertendo')).toBeTruthy();
    expect(screen.getByText(/\+1/)).toBeTruthy();
  });

  it('ignora os que já terminaram — só conta o que ainda roda', () => {
    adicionarJob(job('a', 'DUTE', 'done'));
    adicionarJob(job('b', 'PETRIN', 'error'));
    montar('/exportacoes');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clicar leva de volta à tela de conversão — o caminho que faltava', () => {
    adicionarJob(job('a', 'DUTE'));
    montar('/exportacoes');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('rota').textContent).toBe('/conversao');
  });

  it('some na própria tela de conversão — lá o painel já está à vista', () => {
    adicionarJob(job('a', 'DUTE'));
    montar('/conversao');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
