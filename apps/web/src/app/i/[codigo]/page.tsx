'use client';
import Link from 'next/link';
import { use } from 'react';
import { Aviso, Carregando } from '@/componentes/basicos';
import { useDados } from '@/lib/hooks';

interface Publico {
  codigo: string;
  nome: string;
  especialidades: string[];
  bairros: string[];
}

/** Link/QR de indicação: contém apenas a referência do prestador. */
export default function Indicacao({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = use(params);
  const { dados, erro, carregando } = useDados<Publico>(
    `/indicacoes/${encodeURIComponent(codigo)}`,
  );
  return (
    <main className="app pilha">
      <div className="marca">
        <img src="/icone.svg" alt="" /> Clube CDC
      </div>
      {carregando && <Carregando />}
      {erro && <Aviso>Código de indicação não encontrado.</Aviso>}
      {dados && (
        <div className="cartao pilha">
          <h1>{dados.nome} indicou a CDC para você</h1>
          <p>
            Profissional: {dados.especialidades.join(', ')} · atende em {dados.bairros.join(', ')}.
          </p>
          <p className="suave">
            Informe o código <strong className="mono">{dados.codigo}</strong> no caixa ou vincule no
            app antes de fechar a compra.
          </p>
          <Link className="botao largo" href={`/app/perfil?vincular=${dados.codigo}`}>
            Vincular no meu app
          </Link>
          <Link className="botao secundario largo" href="/app/aderir">
            Ainda não participo do Clube
          </Link>
        </div>
      )}
    </main>
  );
}
