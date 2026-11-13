import Link from 'next/link';

export default function Inicio() {
  return (
    <main className="inicio pilha">
      <div className="marca" style={{ fontSize: '1.4rem' }}>
        <img src="/icone.svg" alt="" width={40} height={40} /> Clube CDC
      </div>
      <h1>Compre, ganhe crédito e indique profissionais de confiança.</h1>
      <p className="suave">Programa de fidelidade da Casa das Correias — Manaus/AM.</p>
      <div className="grade">
        <Link className="botao" href="/app">
          Sou cliente ou prestador
        </Link>
        <Link className="botao secundario" href="/painel">
          Equipe CDC
        </Link>
      </div>
    </main>
  );
}
