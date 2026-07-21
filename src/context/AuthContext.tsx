import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

// ===================================================================
// AUTENTICAÇÃO INTERNA (banco de dados real — tabela app_users)
// Login por usuário/senha validado via RPC app_login (senha em bcrypt,
// verificada no servidor). O cliente nunca lê hashes. A gestão de
// usuários fica no painel /usuarios (somente admin).
// Ver migration: supabase/migrations/20260721_app_users_auth.sql
// ===================================================================

const SESSION_KEY = "converter-pro-auth";

interface Sessao {
  username: string;
  isAdmin: boolean;
}

interface AuthContextType {
  usuario: string | null;
  isAdmin: boolean;
  autenticado: boolean;
  login: (usuario: string, senha: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function carregarSessao(): Sessao | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as Sessao : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(() => carregarSessao());

  const login = useCallback(async (usuario: string, senha: string) => {
    const user = usuario.trim();
    if (!user || !senha) return false;
    try {
      const { data, error } = await supabase.rpc("app_login", {
        p_username: user,
        p_password: senha,
      });
      if (error) {
        console.warn("[auth] Erro no login:", error.message);
        return false;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return false;
      const nova: Sessao = { username: row.username, isAdmin: !!row.is_admin };
      setSessao(nova);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(nova)); } catch { /* quota */ }
      return true;
    } catch (e) {
      console.warn("[auth] Falha ao autenticar:", e);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setSessao(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
  }, []);

  return (
    <AuthContext.Provider value={{
      usuario: sessao?.username ?? null,
      isAdmin: !!sessao?.isAdmin,
      autenticado: !!sessao,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
