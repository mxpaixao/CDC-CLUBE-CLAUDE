'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const PUBLICAS = ['/app/entrar', '/app/aderir', '/app/regras'];
const NAV = [
  { href: '/app', rotulo: 'Início', icone: '◉' },
  { href: '/app/extrato', rotulo: 'Extrato', icone: '≡' },
  { href: '/app/prestador', rotulo: 'Prestador', icone: '★' },
  { href: '/app/regras', rotulo: 'Regras', icone: '?' },
  { href: '/app/perfil', rotulo: 'Perfil', icone: '☺' },
];

export default function LayoutApp({ children }: { children: React.ReactNode }) {
  const caminho = usePathname();
  const router = useRouter();
  const [logado, setLogado] = useState<boolean | null>(null);
  const publica = PUBLICAS.includes(caminho);

  useEffect(() => {
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  useEffect(() => {
    api('/auth/participante/eu')
      .then(() => setLogado(true))
      .catch(() => {
        setLogado(false);
        if (!publica) router.replace(`/app/entrar?voltar=${encodeURIComponent(caminho)}`);
      });
  }, [caminho, publica, router]);

  return (
    <div className="app">
      <header className="app-topo">
        <Link className="marca" href="/app">
          <img src="/icone.svg" alt="" /> Clube CDC
        </Link>
      </header>
      {publica || logado ? children : <p className="suave">Carregando…</p>}
      {logado && (
        <nav className="nav-inferior" aria-label="Navegação do app">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={caminho === n.href ? 'ativo' : ''}
              aria-current={caminho === n.href ? 'page' : undefined}
            >
              <span className="icone" aria-hidden>
                {n.icone}
              </span>
              {n.rotulo}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
