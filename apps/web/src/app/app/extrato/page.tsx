'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Aviso, Carregando, SeloEstado, Vazio } from '@/componentes/basicos';
import { brl, data, ORIGENS } from '@/lib/formato';
import { useDados } from '@/lib/hooks';

interface Item {
  id: string;
  data: string;
  tipo: string;
  origem: string;
  estado: string;
  valorCentavos: number;
  liberaEm: string | null;
  venceEm: string | null;
  ehLote: boolean;
  motivo: string | null;
  venda: { documentoErp: string } | null;
}
interface Inicio {
  carteiras: { id: string; tipo: string; empresa?: { razaoSocial: string } }[];
}

function Extrato() {
  const parametro = useSearchParams().get('carteira');
  const inicio = useDados<Inicio>('/app/inicio');
  const [carteira, setCarteira] = useState<string | null>(parametro);
  useEffect(() => {
    if (!carteira && inicio.dados?.carteiras[0]) setCarteira(inicio.dados.carteiras[0].id);
  }, [carteira, inicio.dados]);
  const extrato = useDados<{ itens: Item[] }>(carteira ? `/app/extrato/${carteira}` : null);

  return (
    <div className="pilha">
      <h1>Extrato</h1>
      {inicio.dados && inicio.dados.carteiras.length > 1 && (
        <label className="campo">
          Carteira
          <select value={carteira ?? ''} onChange={(e) => setCarteira(e.target.value)}>
            {inicio.dados.carteiras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tipo === 'PRESTADOR'
                  ? 'Recompensas (prestador)'
                  : c.empresa
                    ? c.empresa.razaoSocial
                    : 'Meu cashback'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(inicio.carregando || extrato.carregando) && <Carregando />}
      <Aviso>{extrato.erro?.message}</Aviso>
      {extrato.dados && extrato.dados.itens.length === 0 && (
        <Vazio>Nenhum lançamento ainda. Suas compras aparecem aqui.</Vazio>
      )}
      {extrato.dados && extrato.dados.itens.length > 0 && (
        <ul className="lista-extrato cartao">
          {extrato.dados.itens.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{ORIGENS[l.origem] ?? l.origem}</strong>
                <div className="suave" style={{ fontSize: '0.82rem' }}>
                  {data(l.data)}
                  {l.venda ? ` · doc. ${l.venda.documentoErp}` : ''}
                  {l.ehLote && l.estado === 'PENDENTE' && l.liberaEm
                    ? ` · libera em ${data(l.liberaEm)}`
                    : ''}
                  {l.ehLote && l.estado === 'DISPONIVEL' && l.venceEm
                    ? ` · vence em ${data(l.venceEm)}`
                    : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={`num ${l.valorCentavos >= 0 ? 'positivo' : 'negativo'}`}>
                  {l.valorCentavos > 0 ? '+' : ''}
                  {brl(l.valorCentavos)}
                </div>
                {l.ehLote && <SeloEstado estado={l.estado} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <Extrato />
    </Suspense>
  );
}
