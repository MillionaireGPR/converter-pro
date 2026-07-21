-- ===================================================================
-- AUTENTICAÇÃO INTERNA (app_users) — reunião 21/07/2026
-- Login básico por usuário/senha, com gestão de usuários no painel.
-- Segurança: senhas em bcrypt (pgcrypto); o cliente NUNCA lê a tabela
-- direto (RLS sem policies). Todo acesso é via RPCs SECURITY DEFINER,
-- que nunca retornam o hash. Ações de gestão exigem re-verificação de
-- um admin (usuário + senha) a cada chamada.
-- ===================================================================

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;
-- Sem policies => sem acesso direto via anon/authenticated. Só pelas RPCs abaixo.

-- LOGIN: retorna (username, is_admin) se a senha conferir; senão vazio.
create or replace function public.app_login(p_username text, p_password text)
returns table(username text, is_admin boolean)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  select u.username, u.is_admin
  from public.app_users u
  where lower(u.username) = lower(p_username)
    and u.password_hash = crypt(p_password, u.password_hash);
end; $$;

-- Helper interno: valida se o par (usuário, senha) é um admin válido.
create or replace function public._app_is_admin(p_admin_user text, p_admin_pass text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select exists(
    select 1 from public.app_users u
    where lower(u.username) = lower(p_admin_user)
      and u.is_admin = true
      and u.password_hash = crypt(p_admin_pass, u.password_hash)
  );
$$;

-- LISTAR usuários (somente admin).
create or replace function public.app_list_users(p_admin_user text, p_admin_pass text)
returns table(username text, is_admin boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._app_is_admin(p_admin_user, p_admin_pass) then return; end if;
  return query
  select u.username, u.is_admin, u.created_at
  from public.app_users u order by u.created_at;
end; $$;

-- CRIAR usuário (somente admin).
create or replace function public.app_create_user(
  p_admin_user text, p_admin_pass text,
  p_username text, p_password text, p_is_admin boolean default false)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._app_is_admin(p_admin_user, p_admin_pass) then return 'NAO_AUTORIZADO'; end if;
  if coalesce(trim(p_username),'') = '' or coalesce(p_password,'') = '' then return 'DADOS_INVALIDOS'; end if;
  if exists(select 1 from public.app_users where lower(username) = lower(p_username)) then return 'JA_EXISTE'; end if;
  insert into public.app_users(username, password_hash, is_admin)
  values (trim(p_username), crypt(p_password, gen_salt('bf')), coalesce(p_is_admin, false));
  return 'OK';
end; $$;

-- ALTERAR senha de um usuário (somente admin).
create or replace function public.app_change_password(
  p_admin_user text, p_admin_pass text, p_username text, p_new_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._app_is_admin(p_admin_user, p_admin_pass) then return 'NAO_AUTORIZADO'; end if;
  if coalesce(p_new_password,'') = '' then return 'DADOS_INVALIDOS'; end if;
  update public.app_users set password_hash = crypt(p_new_password, gen_salt('bf'))
  where lower(username) = lower(p_username);
  if not found then return 'NAO_ENCONTRADO'; end if;
  return 'OK';
end; $$;

-- EXCLUIR usuário (somente admin; não pode excluir a si mesmo).
create or replace function public.app_delete_user(
  p_admin_user text, p_admin_pass text, p_username text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._app_is_admin(p_admin_user, p_admin_pass) then return 'NAO_AUTORIZADO'; end if;
  if lower(p_admin_user) = lower(p_username) then return 'NAO_PODE_EXCLUIR_SI'; end if;
  delete from public.app_users where lower(username) = lower(p_username);
  if not found then return 'NAO_ENCONTRADO'; end if;
  return 'OK';
end; $$;

-- Permite o cliente (anon key) executar apenas as RPCs — nunca a tabela.
grant execute on function public.app_login(text,text) to anon, authenticated;
grant execute on function public.app_list_users(text,text) to anon, authenticated;
grant execute on function public.app_create_user(text,text,text,text,boolean) to anon, authenticated;
grant execute on function public.app_change_password(text,text,text,text) to anon, authenticated;
grant execute on function public.app_delete_user(text,text,text) to anon, authenticated;

-- Usuário padrão: admin / admin (troque a senha no primeiro acesso).
insert into public.app_users(username, password_hash, is_admin)
values ('admin', crypt('admin', gen_salt('bf')), true)
on conflict (username) do nothing;
