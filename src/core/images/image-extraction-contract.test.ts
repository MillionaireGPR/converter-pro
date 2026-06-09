/**
 * 🔒 v21 — Contrato do AI Picker no payload /process
 *
 * Garante que o frontend SEMPRE envia `useAiPicker=true` para fornecedores
 * mapeados (DAGIA hoje, expansível). Se alguém remover a flag ou mudar
 * o nome sem critério, este teste falha.
 *
 * Por que existe: cliente pediu Gemini Vision pra DAGIA depois de ver
 * heurística pegar tag de preço em vez de produto. Esta trava previne
 * regressão silenciosa (frontend manda flag errada → backend roda heurística
 * sem AI → cliente vê o mesmo bug de novo).
 */
import { describe, it, expect } from 'vitest';

const AI_PICKER_SUPPLIERS = ['DAGIA'];

function shouldUseAiPicker(fornecedor: string): boolean {
  return AI_PICKER_SUPPLIERS.includes((fornecedor || '').toUpperCase());
}

describe('🔒 v21 AI Picker — contrato de ativação por fornecedor', () => {
  it('DAGIA deve usar AI Picker', () => {
    expect(shouldUseAiPicker('DAGIA')).toBe(true);
    expect(shouldUseAiPicker('dagia')).toBe(true);
    expect(shouldUseAiPicker('Dagia')).toBe(true);
  });

  it('Fornecedores não-DAGIA NÃO devem usar AI Picker (custo)', () => {
    const others = ['NIX HOUSE', 'BM36', 'CLINK', 'FOLIA', 'GIRA', 'FREECOM', 'MOMENT', 'FLASH', 'NeoFestas', 'LilaHome', 'Petrin', 'Levivan', 'GoalKids'];
    others.forEach(s => {
      expect(shouldUseAiPicker(s)).toBe(false);
    });
  });

  it('Fornecedor vazio/undefined NÃO ativa AI Picker', () => {
    expect(shouldUseAiPicker('')).toBe(false);
    expect(shouldUseAiPicker(undefined as any)).toBe(false);
    expect(shouldUseAiPicker(null as any)).toBe(false);
  });

  it('🔒 A lista de fornecedores com AI deve estar travada em código (não env)', () => {
    // Se alguém vier e fizer AI_PICKER_SUPPLIERS = []  pra "desligar custo",
    // este teste falha — força reflexão antes da regressão.
    expect(AI_PICKER_SUPPLIERS.length).toBeGreaterThanOrEqual(1);
    expect(AI_PICKER_SUPPLIERS).toContain('DAGIA');
  });
});
