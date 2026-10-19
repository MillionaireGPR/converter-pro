# Converter Pro — Resumo do Projeto

> Infraestrutura: `CLAUDE.md` seção 0 (referência única).
> A versão anterior deste resumo (maio/2026: "Render/Railway", parsers regex + OpenCV como motor
> principal) está em `docs/historico/PROJECT_SUMMARY-2026-06.md` e não vale mais.

**O que é:** conversor de catálogos de fornecedores (PDF/Excel) para planilhas Mercos/ERP/JAWEB,
usado pela Nunes Representações.

**Como funciona hoje (10/2026):**
- O navegador (Vercel) envia o PDF ao motor de conversão (backend FastAPI no servidor Integrator).
- O motor usa o **Gemini** para ler produtos (código, nome, preço, caixa, promoção) e escolher fotos;
  regras medidas no próprio PDF corrigem o que a IA erra. Excel é lido no navegador.
- Dados e histórico ficam no Supabase. Detalhes de servidor, banco, modelos e variáveis: `CLAUDE.md` seção 0.

**Onde está cada assunto:** regras e workflow → `CLAUDE.md`; invariantes → `ARCHITECTURE.md`;
histórico de correções → `guide.md` §14+; onde paramos → `CONTINUIDADE.md`.
