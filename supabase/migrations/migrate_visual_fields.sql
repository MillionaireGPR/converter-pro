-- =========================================================================
-- MIGRAÇÃO: Adicionar colunas de metadados visuais e imagem
-- Cole no SQL Editor do Supabase e clique em RUN
-- =========================================================================

ALTER TABLE public.standardized_products
  ADD COLUMN IF NOT EXISTS visual_category TEXT,
  ADD COLUMN IF NOT EXISTS is_promotional BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_fixed_price BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS additional_info TEXT,
  ADD COLUMN IF NOT EXISTS image_match_status TEXT,
  ADD COLUMN IF NOT EXISTS image_match_confidence NUMERIC;
