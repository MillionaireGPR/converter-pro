-- =========================================================================
-- SCRIPT DE MIGRAÇÃO: SUPERBASE PRÓPRIO - CONVERTER-PRO
-- Cole isto no Editor SQL do seu novo projeto em app.supabase.com
-- =========================================================================

-- 1. Criar Tabela suppliers (Fornecedores)
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    file_type TEXT,
    frequency TEXT,
    default_discount NUMERIC,
    default_ipi NUMERIC,
    last_processed TEXT,
    total_products NUMERIC,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Criar Tabela standardized_products (Produtos Padronizados)
CREATE TABLE public.standardized_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    original_code TEXT NOT NULL,
    final_code TEXT,
    name TEXT NOT NULL,
    description TEXT,
    base_price NUMERIC,
    discount_percent NUMERIC,
    final_price NUMERIC,
    ipi NUMERIC,
    unit TEXT,
    box_qty NUMERIC,
    categoria TEXT,
    embalagem TEXT,
    status TEXT,
    errors JSONB,
    has_image BOOLEAN DEFAULT false,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Criar Tabela export_history (Histórico de Exportações)
CREATE TABLE public.export_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    supplier_name TEXT,
    user_name TEXT,
    date TEXT,
    conversion_type TEXT,
    item_count NUMERIC,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Configurações Adicionais de Segurança (Opcional, mas recomendado liberar para MVP local)
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standardized_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

-- Exemplo: Permitir tudo para acessos autenticados por ANON KEY (para facilidade, igual Lovable)
CREATE POLICY "Permitir Leitura Suppliers" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Permitir Insert Suppliers" ON public.suppliers FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir Update Suppliers" ON public.suppliers FOR UPDATE USING (true);
CREATE POLICY "Permitir Delete Suppliers" ON public.suppliers FOR DELETE USING (true);

CREATE POLICY "Permitir Leitura Products" ON public.standardized_products FOR SELECT USING (true);
CREATE POLICY "Permitir Insert Products" ON public.standardized_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir Update Products" ON public.standardized_products FOR UPDATE USING (true);
CREATE POLICY "Permitir Delete Products" ON public.standardized_products FOR DELETE USING (true);

CREATE POLICY "Permitir Leitura History" ON public.export_history FOR SELECT USING (true);
CREATE POLICY "Permitir Insert History" ON public.export_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir Update History" ON public.export_history FOR UPDATE USING (true);
CREATE POLICY "Permitir Delete History" ON public.export_history FOR DELETE USING (true);
