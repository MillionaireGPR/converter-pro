import { describe, it, expect } from 'vitest';
import { processarArquivo } from './engine';

describe('Motor do Conversor', () => {
  it('deve normalizar dados da Clink corretamente', () => {
    const rawData = [
      {
        'Ref': 'CK123',
        'Nome': 'Produto Teste',
        'Preco': '1.234,56',
        'IPI': '10',
        'Un': 'UN',
        'Qtd_Caixa': '12',
        'Categoria': 'Utilidades'
      }
    ];

    const result = processarArquivo(rawData, 'clink');

    expect(result.produtos.length).toBe(1);
    const p = result.produtos[0];
    expect(p.codigo).toBe('CK123');
    expect(p.nome).toBe('Produto Teste');
    expect(p.precoBase).toBe(1234.56);
    expect(p.ipi).toBe(10);
    expect(p.quantidadeCaixa).toBe(12);
    expect(p.status).toBe('validado');
  });

  it('deve marcar erro quando faltar campos obrigatórios', () => {
    const rawData = [
      {
        'Ref': '', // Sem código
        'Nome': 'Produto Sem Código',
        'Preco': '10,00'
      }
    ];

    const result = processarArquivo(rawData, 'clink');
    expect(result.produtos[0].status).toBe('erro');
    expect(result.produtos[0].erros).toContain('Código do produto não encontrado ou vazio.');
  });

  it('deve processar Bosch com colunas em inglês', () => {
    const rawData = [
      {
        'part_number': 'BOSCH-001',
        'description': 'Furadeira Especial',
        'net_price': '500.00',
        'moq': '1'
      }
    ];

    const result = processarArquivo(rawData, 'bosch');
    const p = result.produtos[0];
    expect(p.codigo).toBe('BOSCH-001');
    expect(p.nome).toBe('Furadeira Especial');
    expect(p.precoBase).toBe(500);
    expect(p.status).toBe('validado');
  });
});
