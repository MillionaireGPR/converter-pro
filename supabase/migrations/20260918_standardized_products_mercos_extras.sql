-- Tabelas de preço extra (#1..#19) e campos Mercos mapeados pelo cliente precisam
-- sobreviver ao round-trip da base padronizada até a exportação (VAESO V50/V250/V.R.).
ALTER TABLE public.standardized_products
  ADD COLUMN IF NOT EXISTS mercos_extras jsonb;
