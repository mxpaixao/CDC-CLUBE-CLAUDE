'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ContextoUsuario, pode, type UsuarioPainel } from '@/lib/painel';

const MENU = [
  { href: '/painel', rotulo: 'Visão geral', p: ['visualizacao_relatorios'] },
  { href: '/painel/caixa', rotulo: 'Caixa', p: ['operacao_caixa'] },
  {
    href: '/painel/clientes',
    rotulo: 'Clientes',
    p: ['cadastro', 'operacao_caixa', 'ajuste_saldo', 'visualizacao_relatorios'],
  },
  {
    href: '/painel/prestadores',
    rotulo: 'Prestadores',
    p: ['aprovacao_prestador', 'visualizacao_relatorios'],
  },
  {
    href: '/painel/bonus',
    rotulo: 'Bônus e resgates',
    p: ['visualizacao_relatorios', 'operacao_caixa'],
  },
  {
    href: '/painel/regras',
    rotulo: 'Regras e campanhas',
    p: ['alteracao_regras', 'visualizacao_relatorios'],
  },
  {
    href: '/painel/importacao',
    rotulo: 'Importação e conciliação',
    p: ['visualizacao_relatorios'],
  },
  { href: '/painel/usuarios', rotulo: 'Usuários e auditoria', p: ['admin'] },
];

export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  const caminho = usePathname();
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioPainel | null>(null);
  const [contingencia, setContingencia] = useState<{
    ativa: boolean;
    motivo: string | null;
  } | null>(null);
  const entrar = caminho === '/painel/entrar';

  useEffect(() => {
    if (entrar) return;
    api<UsuarioPainel>('/auth/equipe/eu')
      .then((u) => {
        setUsuario(u);
        void api<{ ativa: boolean; motivo: string | null }>('/sistema/contingencia')
          .then(setContingencia)
          .catch(() => undefined);
      })
      .catch(() => router.replace('/painel/entrar'));
  }, [entrar, router, caminho]);

  if (entrar) return <>{children}</>;
  if (!usuario)
    return (
      <p className="suave" style={{ padding: 24 }}>
        Carregando…
      </p>
    );
  const sair = async () => {
    await api('/auth/equipe/logout', { body: {} });
    router.replace('/painel/entrar');
  };

  return (
    <ContextoUsuario.Provider value={usuario}>
      <div className="painel">
        <nav className="painel-menu" aria-label="Menu do painel">
          <div className="marca titulo-menu" style={{ padding: '4px 12px 16px' }}>
            <img src="/icone.svg" alt="" /> Painel CDC
          </div>
          {MENU.filter((m) => pode(usuario, ...m.p)).map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={caminho === m.href ? 'ativo' : ''}
              aria-current={caminho === m.href ? 'page' : undefined}
            >
              {m.rotulo}
            </Link>
          ))}
          <div className="titulo-menu" style={{ padding: '16px 12px 0' }}>
            <small>{usuario.nome}</small>
            <br />
            <button
              className="botao secundario pequeno"
              onClick={() => void sair()}
              style={{ marginTop: 8 }}
            >
              Sair
            </button>
          </div>
        </nav>
        <main className="painel-conteudo">
          {contingencia?.ativa && (
            <div className="aviso alerta" style={{ marginBottom: 16 }}>
              <strong>Modo contingência:</strong> {contingencia.motivo}. Liberações de crédito
              pausadas; resgates exigem liberação de supervisor.
            </div>
          )}
          {children}
        </main>
      </div>
    </ContextoUsuario.Provider>
  );
}
