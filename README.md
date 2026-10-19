# Converter-Pro (Central de Conversão)

> Infraestrutura: `CLAUDE.md` seção 0 (referência única).

Ferramenta da Nunes Representações que converte catálogos de fornecedores (PDF e Excel)
em planilhas prontas para Mercos/ERP, com preço, caixa, promoção e foto de cada produto.

- **Site:** https://centraldeconversao.vercel.app (frontend React + Vite, Vercel).
- **Motor de conversão:** backend Python/FastAPI com Gemini, no servidor Integrator.
- **Onde roda cada parte, como publicar e como conferir:** `CLAUDE.md` seção 0.

## Documentos

| Documento | Para quê |
|---|---|
| `CLAUDE.md` | Regras de trabalho e **seção 0 (infraestrutura)** |
| `CONTINUIDADE.md` | Onde paramos / próximos passos |
| `ARCHITECTURE.md` | Invariantes IV-01..IV-23 que não podem quebrar |
| `guide.md` | Histórico técnico detalhado de cada correção (§14+) |
| `SECURITY.md` | Regras de segurança e estado das dependências |
| `IQC_STATUS_ATUAL.md` | Estado operacional (lido pela IQC Machine) |
| `docs/historico/` | Versões antigas de documentos, só para consulta |

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:8080
npm run verify     # invariantes + tipos + testes (obrigatório antes do push)
```

Backend: `cd backend/image_extractor && pip install -r requirements.txt && uvicorn main:app --port 8000`.
