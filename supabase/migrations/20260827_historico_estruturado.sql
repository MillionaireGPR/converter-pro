-- ===================================================================
-- HISTÓRICO ESTRUTURADO (27/08/2026)
-- ===================================================================
-- Contexto: o histórico gravava servidor/tempo/parser embutidos como texto
-- dentro de `conversion_type` (ex: "Importação (pdf-ai-first · IA) · 4:54 ·
-- proprio") e o relatório de SKUs sem imagem só existia no navegador que
-- rodou a conversão — baixável na hora, mas perdido depois (não dava pra
-- conferir de outra máquina qual servidor processou ou revisar as falhas
-- de uma conversão já fechada). Este arquivo separa esses dados em colunas
-- reais (filtráveis/ordenáveis) e persiste o relatório de falhas no banco.
--
-- O relatório de falhas é só texto (SKU + página + motivo, sem imagem) —
-- nunca passa de poucos KB mesmo em catálogos grandes, por isso cabe numa
-- coluna TEXT sem risco de estourar o banco. As conversões completas
-- (produtos + imagens em base64) CONTINUAM só no localStorage do
-- navegador — são grandes demais pra Supabase e o objetivo do histórico
-- nunca foi virar um arquivo morto, e sim servir de painel de diagnóstico
-- recente (ver retenção abaixo).
-- ===================================================================

ALTER TABLE public.export_history
  ADD COLUMN IF NOT EXISTS server_used TEXT,
  ADD COLUMN IF NOT EXISTS duration_sec NUMERIC,
  ADD COLUMN IF NOT EXISTS parser_used TEXT,
  ADD COLUMN IF NOT EXISTS used_ai BOOLEAN,
  ADD COLUMN IF NOT EXISTS images_found NUMERIC,
  ADD COLUMN IF NOT EXISTS images_matched NUMERIC,
  ADD COLUMN IF NOT EXISTS images_failed NUMERIC,
  ADD COLUMN IF NOT EXISTS failure_report TEXT;

COMMENT ON COLUMN public.export_history.server_used IS
  'proprio | render | local | outro — de backendLabel() no frontend no momento da conversão.';
COMMENT ON COLUMN public.export_history.failure_report IS
  'Texto do relatório de SKUs sem imagem (mesmo formato do .txt baixado no painel). NULL quando não houve falha de imagem.';

-- -------------------------------------------------------------------
-- Retenção: catálogo é atualizado toda semana pelo fornecedor, então o
-- histórico não precisa (e não deve) crescer indefinidamente — o painel é
-- pra diagnosticar o que aconteceu recentemente, não virar um arquivo
-- morto. Mantemos só os últimos 14 dias (2 ciclos semanais, margem pra
-- comparar "essa semana vs a passada" sem acumular lixo).
--
-- Implementação em duas camadas porque nem todo projeto Supabase tem
-- pg_cron habilitado (depende do plano/config):
--   1) Função + agendamento via pg_cron, se a extensão existir (silenciosa
--      se não existir — não quebra a migration).
--   2) Fallback garantido: limpeza oportunista disparada pelo FRONTEND
--      (ver HistoricoContext.tsx) toda vez que alguém abre a tela de
--      Histórico, no máximo 1x/dia por navegador. Funciona em qualquer
--      plano, sem depender de infra extra.
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.limpar_historico_antigo()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.export_history
  WHERE created_at < (timezone('utc'::text, now()) - interval '14 days');
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'limpar_historico_antigo_diario',
      '0 6 * * *', -- todo dia às 06:00 UTC
      $$SELECT public.limpar_historico_antigo();$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron existe mas o schedule falhou (ex: já agendado, sem permissão) —
  -- não deve derrubar a migration; o fallback do frontend cobre o caso.
  NULL;
END $$;
