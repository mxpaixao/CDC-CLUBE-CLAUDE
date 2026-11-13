'use client';
import type { ReactNode } from 'react';
import { ESTADOS } from '@/lib/formato';

export function Aviso({
  tipo = 'erro',
  children,
}: {
  tipo?: 'erro' | 'ok' | 'alerta' | 'info';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <div className={`aviso ${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p className="suave" aria-busy="true">
      {texto}
    </p>
  );
}

export function Selo({ tipo = '', children }: { tipo?: string; children: ReactNode }) {
  return <span className={`selo ${tipo}`}>{children}</span>;
}

export function SeloEstado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { rotulo: estado, classe: '' };
  return <Selo tipo={e.classe}>{e.rotulo}</Selo>;
}

export function Kpi({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
}) {
  return (
    <div className="cartao">
      <div className="kpi-rotulo">{rotulo}</div>
      <div className="kpi">{valor}</div>
      {detalhe ? <small>{detalhe}</small> : null}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}
