import { describe, it, expect } from 'vitest';
import { buildCommercialProductName, removeCommercialSuffix } from './clink-family-base';

describe('commercialName Tests', () => {
  it('must append ***PROMOCAO*** to promotional items', () => {
    const baseName = "ARRANHADOR GATO";
    const result = buildCommercialProductName(baseName, 'promocional');
    expect(result.nomeComercial).toBe("ARRANHADOR GATO ***PROMOCAO***");
  });

  it('must append ***PRECO FIXO*** to fixed price items', () => {
    const baseName = "ARRANHADOR GATO";
    const result = buildCommercialProductName(baseName, 'preco-fixo');
    expect(result.nomeComercial).toBe("ARRANHADOR GATO ***PRECO FIXO***");
  });

  it('must not append suffix to standard items', () => {
    const baseName = "ARRANHADOR GATO";
    const result = buildCommercialProductName(baseName, 'padrao');
    expect(result.nomeComercial).toBe("ARRANHADOR GATO");
  });

  it('must not duplicate suffixes', () => {
    const baseName = "ARRANHADOR GATO ***PROMOCAO***";
    const result = buildCommercialProductName(baseName, 'promocional');
    expect(result.nomeComercial).toBe("ARRANHADOR GATO ***PROMOCAO***");
  });

  it('removeCommercialSuffix must remove suffixes', () => {
    expect(removeCommercialSuffix("ARRANHADOR GATO ***PROMOCAO***")).toBe("ARRANHADOR GATO");
    expect(removeCommercialSuffix("ARRANHADOR GATO ***PRECO FIXO***")).toBe("ARRANHADOR GATO");
  });
});
