import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  environment: string;
  updated_at: string;
}

// Cache local para evitar múltiplas requisições
let flagsCache: FeatureFlag[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 60000; // 1 minuto

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFlags = useCallback(async (force = false) => {
    // Usar cache se disponível e não expirado
    if (!force && flagsCache && Date.now() - lastFetch < CACHE_TTL) {
      setFlags(flagsCache);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data, error: supaError } = await (supabase.from('feature_flags') as any)
        .select('*')
        .order('name');

      if (supaError) throw supaError;

      flagsCache = data || [];
      lastFetch = Date.now();
      setFlags(flagsCache);
    } catch (err) {
      console.error('[FeatureFlags] Erro ao carregar:', err);
      setError('Falha ao carregar feature flags');
      // Fallback: usar flags padrão em modo offline
      setFlags([
        { key: 'debug_logs', enabled: true, name: 'Debug', description: '', environment: 'all', id: '1', updated_at: '' },
        { key: 'modo_teste', enabled: true, name: 'Teste', description: '', environment: 'all', id: '2', updated_at: '' }
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isEnabled = useCallback((key: string): boolean => {
    const flag = flags.find(f => f.key === key);
    return flag?.enabled ?? false;
  }, [flags]);

  const toggleFlag = useCallback(async (key: string, enabled: boolean) => {
    try {
      // Atualizar estado local IMEDIATAMENTE (otimista)
      setFlags(prev => prev.map(f => 
        f.key === key ? { ...f, enabled } : f
      ));
      
      // Invalidar cache global imediatamente
      flagsCache = null;
      lastFetch = 0;
      
      const { error: updateError } = await (supabase.from('feature_flags') as any)
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('key', key);

      if (updateError) {
        // Reverter em caso de erro
        setFlags(prev => prev.map(f => 
          f.key === key ? { ...f, enabled: !enabled } : f
        ));
        throw updateError;
      }
      
      // Atualizar cache com o novo valor
      const currentFlags = flagsCache || [];
      const updatedCache = currentFlags.map(f => 
        f.key === key ? { ...f, enabled } : f
      );
      flagsCache = updatedCache;
      lastFetch = Date.now();
      
      return true;
    } catch (err) {
      console.error('[FeatureFlags] Erro ao atualizar:', err);
      toast.error('Erro ao salvar no servidor. Verifique sua conexão.');
      return false;
    }
  }, []);

  useEffect(() => {
    fetchFlags();

    // Atualizar a cada 30 segundos (para pegar mudanças em tempo real)
    const interval = setInterval(() => {
      fetchFlags(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchFlags]);

  return {
    flags,
    isLoading,
    error,
    isEnabled,
    toggleFlag,
    refresh: () => fetchFlags(true)
  };
}

// Hook simplificado para verificar uma flag específica
export function useFlag(key: string): boolean {
  const { isEnabled, flags } = useFeatureFlags();
  
  // Retorna o estado atual da flag
  return flags.find(f => f.key === key)?.enabled ?? false;
}
