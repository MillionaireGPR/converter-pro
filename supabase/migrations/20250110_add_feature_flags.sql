-- Migração: Sistema de Feature Flags
-- Permite ativar/desativar funcionalidades em tempo real

-- Tabela de Feature Flags
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,      -- Identificador único da flag (ex: 'novo_desconto_engine')
  name VARCHAR(200) NOT NULL,              -- Nome amigável para exibição
  description TEXT,                        -- Descrição do que a flag controla
  enabled BOOLEAN DEFAULT FALSE,           -- Status atual (true/false)
  environment VARCHAR(20) DEFAULT 'all', -- 'all', 'development', 'production'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Inserir flags iniciais (desativadas por padrão)
INSERT INTO feature_flags (key, name, description, enabled) VALUES
  ('novo_desconto_engine', 'Novo Motor de Descontos', 'Ativa o novo sistema de bloqueio de descontos para promoções e preços fixos', false),
  ('beta_export_pdf', 'Exportação PDF Beta', 'Nova versão da exportação PDF com layout melhorado', false),
  ('debug_logs', 'Logs de Debug', 'Exibe logs detalhados no console para diagnóstico', true),
  ('modo_teste', 'Modo de Teste', 'Indica que o sistema está em modo de teste/desenvolvimento', true)
ON CONFLICT (key) DO NOTHING;

-- Política RLS: Permitir leitura para todos (anon e authenticated)
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de flags para todos" ON feature_flags;
CREATE POLICY "Permitir leitura de flags para todos"
  ON feature_flags FOR SELECT
  TO anon, authenticated
  USING (true);

-- Política RLS: Apenas authenticated pode modificar
DROP POLICY IF EXISTS "Permitir modificação apenas para authenticated" ON feature_flags;
CREATE POLICY "Permitir modificação apenas para authenticated"
  ON feature_flags FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE feature_flags IS 'Sistema de feature flags para ativar/desativar funcionalidades em tempo real';
