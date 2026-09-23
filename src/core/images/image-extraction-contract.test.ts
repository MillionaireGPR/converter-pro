/**
 * 🔒 Contrato do payload /process — opções de foto (23/09/2026)
 *
 * O tratamento das fotos (IA escolhe a foto / foto montada por várias
 * imagens) vem das OPÇÕES do cadastro do fornecedor. Antes era uma lista fixa
 * de nomes aqui (['DAGIA']) e "dute" no backend: fornecedor recadastrado com
 * outro nome perdia o tratamento sem aviso. Este teste chama a função real e
 * lê o FormData que vai pro servidor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../backendResolver', () => ({
  getBackendUrl: async () => 'http://backend.test',
  invalidateBackend: () => {},
}));

import { extractImagesViaBackend } from './imageExtractionApi';
import type { OpcoesCatalogo } from '../../context/types';

async function payloadEnviado(fornecedor: string, opcoes?: OpcoesCatalogo): Promise<FormData> {
  let enviado: FormData | null = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) enviado = init.body;
    return new Response(JSON.stringify({ detail: 'parar aqui' }), { status: 400 });
  }));
  const file = new File([new Uint8Array([37, 80, 68, 70])], 'catalogo.pdf', { type: 'application/pdf' });
  await extractImagesViaBackend(file, [], fornecedor, opcoes);
  expect(enviado).not.toBeNull();
  return enviado as unknown as FormData;
}

describe('🔒 /process — opções de foto vêm do cadastro, não do nome', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('opções marcadas chegam no pedido, com qualquer nome de fornecedor', async () => {
    const fd = await payloadEnviado('FORNECEDOR NOVO', { iaEscolheFoto: true, fotoComposta: true });
    expect(fd.get('useAiPicker')).toBe('true');
    expect(fd.get('fotoComposta')).toBe('true');
  });

  it('o nome sozinho não liga nada (DAGIA/DUTE sem opção = desligado)', async () => {
    for (const nome of ['DAGIA', 'DUTE PDF']) {
      const fd = await payloadEnviado(nome);
      expect(fd.get('useAiPicker')).toBe('false');
      expect(fd.get('fotoComposta')).toBe('false');
    }
  });
});
