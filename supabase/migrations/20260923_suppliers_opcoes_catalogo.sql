-- Opções de foto do catálogo PDF no cadastro do fornecedor (23/09/2026).
-- Substituem o tratamento que era ligado pelo NOME no código ("dute" →
-- foto composta; "DAGIA" → IA escolhe a foto). Fornecedor recadastrado com
-- outro nome perdia o tratamento sem aviso.
alter table public.suppliers
  add column if not exists opcoes_catalogo jsonb not null default '{}'::jsonb;

comment on column public.suppliers.opcoes_catalogo is
  'Opções de foto do catálogo PDF: {"fotoComposta": bool, "iaEscolheFoto": bool}';

-- Mantém o comportamento atual dos cadastros existentes até serem refeitos.
update public.suppliers
  set opcoes_catalogo = opcoes_catalogo || '{"fotoComposta": true}'::jsonb
  where name ilike '%dute%';

update public.suppliers
  set opcoes_catalogo = opcoes_catalogo || '{"iaEscolheFoto": true}'::jsonb
  where name ilike 'dagia%';
