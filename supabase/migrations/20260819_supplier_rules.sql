-- ===================================================================
-- REGRAS POR FORNECEDOR (19/08/2026)
-- ===================================================================
-- Motivação: cada catálogo/planilha nova de fornecedor com layout próprio
-- exigia o desenvolvedor editar código (alias de coluna ou SUPPLIER_HINTS),
-- abrir PR e deployar. Isso tornou o produto dependente do dev e gerou
-- retrabalho constante pro cliente (Michele/Josef), que precisava reportar
-- cada divergência e esperar correção.
--
-- Estas colunas movem essa configuração para as MÃOS DO CLIENTE, uma vez
-- por fornecedor:
--
--   column_mappings  → planilhas (XLSX/CSV): de qual coluna vem cada campo.
--                      Caminho determinístico, NÃO passa por IA.
--                      Ex.: {"quantidadeCaixa":"Caixa master",
--                            "precoTabela1":"V50","precoTabela2":"V250"}
--
--   extraction_rules → catálogos PDF: o cliente descreve em texto livre as
--                      particularidades do fornecedor (ex.: "o preço vem
--                      uma vez só e vale para todas as cores da página").
--                      Alimenta o prompt do Gemini.
--
--   extraction_rules_compiled → o texto livre acima, já COMPILADO em regras
--                      objetivas/imperativas pelo próprio sistema. Evita que
--                      texto solto do usuário desfoque o prompt; a compilação
--                      roda uma vez e é reaproveitada.
--
-- Seguro de rodar mais de uma vez (IF NOT EXISTS).
-- ===================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS column_mappings JSONB,
  ADD COLUMN IF NOT EXISTS extraction_rules TEXT,
  ADD COLUMN IF NOT EXISTS extraction_rules_compiled TEXT;

COMMENT ON COLUMN public.suppliers.column_mappings IS
  'Mapeamento explícito campo→coluna para planilhas deste fornecedor. Vence a detecção automática.';
COMMENT ON COLUMN public.suppliers.extraction_rules IS
  'Regras em texto livre escritas pelo cliente para orientar a leitura de catálogos PDF pela IA.';
COMMENT ON COLUMN public.suppliers.extraction_rules_compiled IS
  'Versão compilada (objetiva) de extraction_rules, gerada pelo sistema e reaproveitada entre conversões.';
