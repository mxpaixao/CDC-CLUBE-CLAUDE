'use client';
import { Aviso, Carregando } from '@/componentes/basicos';
import { useDados } from '@/lib/hooks';

/** Gerado a partir da configuração vigente — muda sozinho quando a CDC altera as regras. */
export default function Regras() {
  const { dados, erro, carregando } =
    useDados<{ titulo: string; itens: string[] }[]>('/app/regras');
  return (
    <div className="pilha">
      <h1>Regras do Clube</h1>
      {carregando && <Carregando />}
      <Aviso>{erro?.message}</Aviso>
      {dados?.map((s) => (
        <section key={s.titulo} className="cartao">
          <h2>{s.titulo}</h2>
          <ul>
            {s.itens.map((i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {i}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
