'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ErroApi } from './api';

/** GET com carregamento/erro/recarregar. `caminho = null` não busca. */
export function useDados<T>(caminho: string | null) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [carregando, setCarregando] = useState(!!caminho);
  const recarregar = useCallback(async () => {
    if (!caminho) return;
    setCarregando(true);
    try {
      setDados(await api<T>(caminho));
      setErro(null);
    } catch (e) {
      setErro(e as ErroApi);
    } finally {
      setCarregando(false);
    }
  }, [caminho]);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);
  return { dados, erro, carregando, recarregar, setDados };
}

/** Executa uma ação com estado de envio e mensagem de erro. */
export function useAcao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const executar = useCallback(async <R>(fn: () => Promise<R>): Promise<R | undefined> => {
    setEnviando(true);
    setErro(null);
    try {
      return await fn();
    } catch (e) {
      setErro((e as Error).message);
      return undefined;
    } finally {
      setEnviando(false);
    }
  }, []);
  return { enviando, erro, setErro, executar };
}
