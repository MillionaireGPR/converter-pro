/**
 * 🔒 TESTE — Produtos marcados "EM BREVE" são tratados como pendentes
 *
 * Cliente Nunes Representações usa a base padronizada para cadastrar produtos
 * no Mercos. Produtos marcados "EM BREVE..." no catálogo devem entrar na
 * extração (não virar erro) e mostrar "EM BREVE" em Informações Adicionais.
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { dagiaAdapter } from './dagia';

describe('🔒 EM BREVE — produtos sem preço marcados no catálogo', () => {
  it('Produto EM BREVE entra como pendente (não erro) com informacoesAdicionais', () => {
    const brutos = [{
      origemArquivo: 'dagia.pdf',
      campos: {
        codigo: 'DXPD51',
        descricao: 'Xicara C/ Pires Opalina 200 ml C/Borda Dourada',
        cx: '12',
        // Flag setada pelo post-process do smartPdfInterpreter:
        __emBreve: true,
        informacoesAdicionais: 'EM BREVE',
      },
      paginaOrigem: 5,
      linhaOrigem: 0,
    }];

    const produtos = extractProducts(brutos as any, dagiaAdapter);
    expect(produtos.length).toBe(1);

    const p = produtos[0] as any;
    expect(p.codigo).toBe('DXPD51');
    expect(p.preco).toBe(0);
    // Crítico: NÃO pode ter "Preço não encontrado" como erro.
    expect(p.erros).not.toContain('Preço não encontrado ou inválido');
    // v18: EM BREVE virou visualCategory (igual promocional/preco-fixo),
    // sem warning. Status ficará 'validado' no pipeline final.
    expect(p.visualCategory).toBe('em-breve');
    // informacoesAdicionais propagado:
    expect(p.informacoesAdicionais).toBe('EM BREVE');
  });

  it('Produto SEM flag emBreve mantém comportamento anterior (sem preço = erro)', () => {
    const brutos = [{
      origemArquivo: 'dagia.pdf',
      campos: {
        codigo: 'XYZ',
        descricao: 'Produto qualquer',
        // sem __emBreve nem preço
      },
      paginaOrigem: 1,
      linhaOrigem: 0,
    }];

    const produtos = extractProducts(brutos as any, dagiaAdapter);
    const p = produtos[0] as any;
    expect(p.erros).toContain('Preço não encontrado ou inválido');
  });

  it('Produto EM BREVE COM preço também aceita (caso raro)', () => {
    const brutos = [{
      origemArquivo: 'dagia.pdf',
      campos: {
        codigo: 'DXPD99',
        descricao: 'Produto raro',
        preco: '50,00',
        __emBreve: true,
        informacoesAdicionais: 'EM BREVE',
      },
      paginaOrigem: 1,
      linhaOrigem: 0,
    }];

    const produtos = extractProducts(brutos as any, dagiaAdapter);
    const p = produtos[0] as any;
    expect(p.preco).toBe(50);
    expect(p.informacoesAdicionais).toBe('EM BREVE');
    // Sem preço inválido warning quando tem preço
    expect(p.erros).not.toContain('Preço não encontrado ou inválido');
  });
});
