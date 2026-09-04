/**
 * Trava as marcações estruturadas do histórico (27/08/2026): servidor usado,
 * contagem de imagens e download do relatório de falhas persistido no banco.
 *
 * Contexto: até aqui, servidor/tempo/parser viviam embutidos como texto
 * dentro de `tipoConversao` (ex: "... · 1:02 · proprio") e o relatório de
 * SKUs sem imagem só existia na memória do navegador que rodou a conversão
 * — perdido ao trocar de máquina ou fechar a aba. Este teste garante que o
 * painel renderiza os campos estruturados como badges filtráveis/legíveis e
 * que o botão de download usa o texto vindo do banco (não recalcula nada).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OperacaoHistorico } from '@/context/types';

const saveAsMock = vi.fn();
vi.mock('file-saver', () => ({ saveAs: (...args: unknown[]) => saveAsMock(...args) }));

let historicoFixture: OperacaoHistorico[] = [];
vi.mock('@/context/HistoricoContext', () => ({
  useHistorico: () => ({
    historico: historicoFixture,
    conversoesSalvas: [],
    reabrirConversao: vi.fn(),
    excluirConversao: vi.fn(),
    exportarImagensConversao: vi.fn(),
  }),
}));
vi.mock('@/context/ProdutosContext', () => ({ useProdutos: () => ({ setProdutosPadronizados: vi.fn() }) }));
vi.mock('@/context/AppContext', () => ({ useApp: () => ({ setDetectedHeaders: vi.fn() }) }));

import Historico from './Historico';

const linhaBase: OperacaoHistorico = {
  id: '1',
  arquivo: 'Catalogo Vaeso 026.pdf',
  fornecedor: 'VAESO',
  usuario: 'josef',
  data: '2026-08-27 15:01',
  tipoConversao: 'Importação (pdf-ai-first · IA) · 1:02 · proprio',
  qtdItens: 162,
  status: 'concluído',
};

const renderHistorico = () => render(<MemoryRouter><Historico /></MemoryRouter>);

describe('Histórico — marcações estruturadas', () => {
  beforeEach(() => {
    saveAsMock.mockClear();
    historicoFixture = [];
  });

  it('mostra o nome exato do servidor usado', () => {
    historicoFixture = [
      { ...linhaBase, id: '0', servidor: 'integrator' },
      { ...linhaBase, id: '1', servidor: 'proprio' },
      { ...linhaBase, id: '2', servidor: 'render' },
    ];
    renderHistorico();

    expect(screen.getByText('Integrator (servidor 1)')).toBeTruthy();
    expect(screen.getByText('Wesley (servidor 2)')).toBeTruthy();
    expect(screen.getByText('Render (servidor 3)')).toBeTruthy();
  });

  it('mostra contagem de imagens associadas/encontradas e destaca falhas', () => {
    historicoFixture = [{
      ...linhaBase,
      imagensEncontradas: 162,
      imagensAssociadas: 145,
      imagensFalhas: 17,
    }];
    renderHistorico();

    expect(screen.getByText(/145\/162/)).toBeTruthy();
    expect(screen.getByText(/17 falhas/)).toBeTruthy();
  });

  it('linha sem falha de imagem não mostra badge de falhas nem botão de download', () => {
    historicoFixture = [{ ...linhaBase, imagensEncontradas: 162, imagensAssociadas: 162, imagensFalhas: 0 }];
    renderHistorico();

    expect(screen.queryByText(/falhas/i)).toBeNull();
  });

  it('baixa o relatório de falhas gravado no banco ao clicar no botão', async () => {
    const relatorio = 'RELATÓRIO DE SKUS SEM IMAGEM\n============================\nSKU: PHD10000 | Página: 6 | Motivo: no_plausible_match';
    historicoFixture = [{
      ...linhaBase,
      imagensFalhas: 1,
      relatorioFalhas: relatorio,
    }];
    renderHistorico();

    const botao = screen.getByRole('button', { name: /falhas \(1\)/i });
    botao.click();

    expect(saveAsMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = saveAsMock.mock.calls[0];
    expect(filename).toBe(`relatorio_falhas_match_${linhaBase.arquivo}.txt`);
    // jsdom não implementa Blob.text() — compara pelo tamanho em bytes
    // (UTF-8) pra confirmar que o conteúdo do banco foi usado sem recálculo.
    expect((blob as Blob).size).toBe(new TextEncoder().encode(relatorio).length);
  });

  it('registro antigo (pré-migration, sem colunas estruturadas) não quebra a tela', () => {
    historicoFixture = [{ ...linhaBase, servidor: undefined, imagensEncontradas: undefined, relatorioFalhas: undefined }];
    expect(() => renderHistorico()).not.toThrow();
    expect(screen.getByText('Catalogo Vaeso 026.pdf')).toBeTruthy();
  });
});
