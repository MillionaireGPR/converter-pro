-- ===================================================================
-- ASSINATURA DO CONVERSOR (28/09/2026)
-- R$249/mês por link de pagamento InfinitePay (PIX ou cartão). A
-- InfinitePay não tem cobrança recorrente: cada mês o cliente gera um link
-- no painel; o pagamento aprovado estende `pago_ate` por `periodo_dias`.
--
-- Segurança:
--  * Tabelas com RLS e SEM policies: anon/authenticated não leem nem
--    escrevem direto. Escrita só pelo backend (service role), que confere
--    cada pagamento na própria InfinitePay (/payment_check) antes de liberar
--    — o webhook da InfinitePay não é assinado, então nunca é confiado sozinho.
--  * O cliente só enxerga o estado (RPC app_assinatura_status) e o histórico
--    sem dados sensíveis (RPC app_assinatura_pagamentos).
--  * Ligar/desligar, preço e liberação manual são do FORNECEDOR do sistema
--    (painel do servidor, token de admin do backend) — não do admin do cliente.
--
-- Nasce DESLIGADA (ativa=false): nada muda para o cliente até ligar.
-- ===================================================================

create table if not exists public.app_assinatura (
  id smallint primary key default 1 check (id = 1),  -- linha única
  ativa boolean not null default false,               -- cobrança ligada?
  valor_centavos integer not null default 24900 check (valor_centavos > 0),
  periodo_dias integer not null default 30 check (periodo_dias between 1 and 366),
  carencia_dias integer not null default 5 check (carencia_dias between 0 and 60),
  aviso_dias integer not null default 5 check (aviso_dias between 0 and 60),
  pago_ate timestamptz,
  -- InfiniteTag (sem $) da conta que recebe. Não é segredo (é público no
  -- link), fica aqui pra valer em todos os servidores sem variável de ambiente.
  infinitepay_handle text,
  atualizado_em timestamptz not null default now()
);

insert into public.app_assinatura(id) values (1) on conflict (id) do nothing;
alter table public.app_assinatura add column if not exists infinitepay_handle text;

create table if not exists public.app_assinatura_pagamentos (
  id uuid primary key default gen_random_uuid(),
  order_nsu text unique not null,
  valor_centavos integer not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'manual')),
  checkout_url text,
  solicitado_por text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  valor_pago_centavos integer,
  metodo text,
  transaction_nsu text,
  invoice_slug text,
  recibo_url text,
  observacao text,
  periodo_ate timestamptz
);

create index if not exists app_assinatura_pagamentos_criado_idx
  on public.app_assinatura_pagamentos (criado_em desc);

alter table public.app_assinatura enable row level security;
alter table public.app_assinatura_pagamentos enable row level security;
-- Sem policies de propósito, e sem grant de tabela para o cliente.
revoke all on table public.app_assinatura from anon, authenticated;
revoke all on table public.app_assinatura_pagamentos from anon, authenticated;

-- ESTADO: fonte única do cálculo (frontend e backend usam a mesma regra).
--  desligada  → cobrança desligada, tudo liberado
--  ativa      → em dia
--  vencendo   → vence em até aviso_dias
--  carencia   → venceu, ainda liberado por carencia_dias
--  bloqueada  → venceu e passou a carência (ou nunca pagou)
create or replace function public.app_assinatura_status()
returns table(
  estado text, ativa boolean, pago_ate timestamptz, bloqueia_em timestamptz,
  dias_restantes integer, valor_centavos integer, periodo_dias integer,
  carencia_dias integer, aviso_dias integer)
language sql stable security definer set search_path = public as $$
  select
    case
      when not a.ativa then 'desligada'
      when a.pago_ate is null then 'bloqueada'
      when now() > a.pago_ate + make_interval(days => a.carencia_dias) then 'bloqueada'
      when now() > a.pago_ate then 'carencia'
      when a.pago_ate - now() <= make_interval(days => a.aviso_dias) then 'vencendo'
      else 'ativa'
    end,
    a.ativa,
    a.pago_ate,
    case when a.pago_ate is null then null
         else a.pago_ate + make_interval(days => a.carencia_dias) end,
    case when a.pago_ate is null then null
         else ceil(extract(epoch from (a.pago_ate - now())) / 86400)::int end,
    a.valor_centavos, a.periodo_dias, a.carencia_dias, a.aviso_dias
  from public.app_assinatura a where a.id = 1;
$$;

-- HISTÓRICO para o cliente: só o necessário (sem NSU/slug).
create or replace function public.app_assinatura_pagamentos()
returns table(criado_em timestamptz, status text, valor_centavos integer,
              pago_em timestamptz, metodo text, recibo_url text, periodo_ate timestamptz)
language sql stable security definer set search_path = public as $$
  select p.criado_em, p.status, coalesce(p.valor_pago_centavos, p.valor_centavos),
         p.pago_em, p.metodo, p.recibo_url, p.periodo_ate
  from public.app_assinatura_pagamentos p
  where p.status <> 'pendente'
  order by p.criado_em desc
  limit 24;
$$;

-- CONFIRMAR PAGAMENTO (só service role / backend). Idempotente: o mesmo
-- order_nsu pago duas vezes (webhook + retorno do navegador) estende 1 vez.
-- Estende a partir do maior entre hoje e o vencimento atual.
create or replace function public.app_assinatura_confirmar(
  p_order_nsu text, p_valor_pago integer, p_metodo text,
  p_transaction_nsu text, p_invoice_slug text, p_recibo_url text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pag public.app_assinatura_pagamentos%rowtype;
  v_ass public.app_assinatura%rowtype;
  v_novo timestamptz;
begin
  select * into v_pag from public.app_assinatura_pagamentos
   where order_nsu = p_order_nsu for update;
  if not found then return 'NAO_ENCONTRADO'; end if;
  if v_pag.status = 'pago' then return 'JA_PAGO'; end if;
  if coalesce(p_valor_pago, 0) < v_pag.valor_centavos then return 'VALOR_MENOR'; end if;

  select * into v_ass from public.app_assinatura where id = 1 for update;
  v_novo := greatest(coalesce(v_ass.pago_ate, now()), now())
            + make_interval(days => v_ass.periodo_dias);

  update public.app_assinatura set pago_ate = v_novo, atualizado_em = now() where id = 1;
  update public.app_assinatura_pagamentos set
    status = 'pago', pago_em = now(), valor_pago_centavos = p_valor_pago,
    metodo = p_metodo, transaction_nsu = p_transaction_nsu,
    invoice_slug = p_invoice_slug, recibo_url = p_recibo_url, periodo_ate = v_novo
   where id = v_pag.id;
  return 'OK';
end; $$;

-- LIBERAÇÃO MANUAL (só service role / backend, atrás do token do fornecedor):
-- pagamento recebido por fora, cortesia, teste. Estende N dias.
create or replace function public.app_assinatura_liberar_manual(p_dias integer, p_observacao text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_novo timestamptz;
begin
  if p_dias is null or p_dias < 1 or p_dias > 366 then
    raise exception 'dias fora do intervalo (1..366)';
  end if;
  update public.app_assinatura
     set pago_ate = greatest(coalesce(pago_ate, now()), now()) + make_interval(days => p_dias),
         atualizado_em = now()
   where id = 1
   returning pago_ate into v_novo;
  insert into public.app_assinatura_pagamentos(order_nsu, valor_centavos, status, pago_em, metodo, observacao, periodo_ate)
  values ('manual-' || gen_random_uuid(), 0, 'manual', now(), 'manual', p_observacao, v_novo);
  return v_novo;
end; $$;

revoke all on function public.app_assinatura_confirmar(text,integer,text,text,text,text) from public, anon, authenticated;
revoke all on function public.app_assinatura_liberar_manual(integer,text) from public, anon, authenticated;
grant execute on function public.app_assinatura_confirmar(text,integer,text,text,text,text) to service_role;
grant execute on function public.app_assinatura_liberar_manual(integer,text) to service_role;

grant execute on function public.app_assinatura_status() to anon, authenticated, service_role;
grant execute on function public.app_assinatura_pagamentos() to anon, authenticated, service_role;
