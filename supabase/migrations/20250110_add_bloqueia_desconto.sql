-- Migração: Adicionar colunas de bloqueio de desconto e categorias visuais
-- Isso é necessário para o sistema identificar produtos promocionais e de preço fixo

-- Adicionar coluna bloqueia_desconto
ALTER TABLE standardized_products 
ADD COLUMN IF NOT EXISTS bloqueia_desconto BOOLEAN DEFAULT FALSE;

-- Adicionar colunas de categoria visual (caso não existam)
ALTER TABLE standardized_products 
ADD COLUMN IF NOT EXISTS visual_category VARCHAR(50);

ALTER TABLE standardized_products 
ADD COLUMN IF NOT EXISTS is_promotional BOOLEAN DEFAULT FALSE;

ALTER TABLE standardized_products 
ADD COLUMN IF NOT EXISTS is_fixed_price BOOLEAN DEFAULT FALSE;

ALTER TABLE standardized_products 
ADD COLUMN IF NOT EXISTS additional_info TEXT;

-- Criar índice para melhorar performance nas buscas por categoria
CREATE INDEX IF NOT EXISTS idx_standardized_products_visual_category 
ON standardized_products(visual_category);

CREATE INDEX IF NOT EXISTS idx_standardized_products_bloqueia_desconto 
ON standardized_products(bloqueia_desconto);

-- Comentário explicativo
COMMENT ON COLUMN standardized_products.bloqueia_desconto IS 'Flag que indica se o produto bloqueia aplicação de desconto (promocional ou preço fixo)';
COMMENT ON COLUMN standardized_products.visual_category IS 'Categoria visual do produto: promocional, preco-fixo, novidade-reposicao, padrao';
