'use client';
import { createContext, useContext } from 'react';

export interface UsuarioPainel {
  id: string;
  nome: string;
  permissoes: string[];
  lojaId: string | null;
}
export const ContextoUsuario = createContext<UsuarioPainel | null>(null);
export const useUsuario = () => useContext(ContextoUsuario);
export const pode = (u: UsuarioPainel | null, ...p: string[]) =>
  !!u && (u.permissoes.includes('admin') || p.some((x) => u.permissoes.includes(x)));
