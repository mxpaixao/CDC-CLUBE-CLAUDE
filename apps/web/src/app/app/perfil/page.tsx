'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Aviso, Carregando } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { data, mascararDoc } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';

interface Perfil {
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  consentimentos: Record<string, boolean>;
  empresas: { razaoSocial: string; cnpj: string; papel: string }[];
}
const CANAIS = [
  { tipo: 'MARKETING_WHATSAPP', rotulo: 'WhatsApp' },
  { tipo: 'MARKETING_SMS', rotulo: 'SMS' },
  { tipo: 'MARKETING_EMAIL', rotulo: 'E-mail' },
];

function PerfilApp() {
  const router = useRouter();
  const vincularInicial = useSearchParams().get('vincular') ?? '';
  const { dados, erro, carregando, recarregar } = useDados<Perfil>('/app/perfil');
  const [codigo, setCodigo] = useState(vincularInicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmaExclusao, setConfirmaExclusao] = useState(false);
  const acao = useAcao();
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Aviso>{erro?.message}</Aviso>;

  const alternar = (tipo: string, valor: boolean) =>
    acao.executar(async () => {
      await api('/app/consentimentos', { method: 'PUT', body: { [tipo]: valor } });
      await recarregar();
    });
  const vincular = () =>
    acao.executar(async () => {
      const r = await api<{ prestador: { nome: string }; ate: string }>('/app/vinculos', {
        body: { codigo },
      });
      setMsg(`Prestador ${r.prestador.nome} vinculado até ${data(r.ate)}.`);
    });
  const sair = async () => {
    await api('/auth/participante/sair', { body: {} });
    router.replace('/app/entrar');
  };
  const excluir = () =>
    acao.executar(async () => {
      await api('/app/conta', { method: 'DELETE', body: { confirmo: true } });
      await sair();
    });

  return (
    <div className="pilha">
      <h1>Perfil</h1>
      <div className="cartao">
        <p>
          <strong>{dados.nome}</strong>
        </p>
        <p className="suave">
          CPF {mascararDoc(dados.cpf)} · {dados.telefone ?? 'sem telefone'}
          {dados.email ? ` · ${dados.email}` : ''}
        </p>
        {dados.empresas.map((e) => (
          <p key={e.cnpj} className="suave">
            Empresa: {e.razaoSocial} ({e.papel.toLowerCase()})
          </p>
        ))}
      </div>
      <section className="cartao">
        <h2>Comunicação</h2>
        <p className="suave">
          Escolha como quer receber avisos de crédito, vencimento e ofertas. Você continua no Clube
          mesmo desligando tudo.
        </p>
        {CANAIS.map((c) => (
          <label key={c.tipo} className="check">
            <input
              type="checkbox"
              checked={!!dados.consentimentos[c.tipo]}
              onChange={(e) => void alternar(c.tipo, e.target.checked)}
              disabled={acao.enviando}
            />
            {c.rotulo}
          </label>
        ))}
      </section>
      <form
        className="cartao pilha"
        onSubmit={(e) => {
          e.preventDefault();
          void vincular();
        }}
      >
        <h2>Vincular um prestador</h2>
        <p className="suave">
          Seu eletricista, encanador ou pintor indicou a CDC? Informe o código dele antes de
          comprar.
        </p>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="CDC-JOAO27"
          aria-label="Código do prestador"
        />
        <button className="botao" disabled={acao.enviando || codigo.length < 3}>
          Vincular
        </button>
        <Aviso tipo="ok">{msg}</Aviso>
      </form>
      <Aviso>{acao.erro}</Aviso>
      <button className="botao secundario largo" onClick={() => void sair()}>
        Sair
      </button>
      <section className="cartao pilha">
        <h2>Excluir minha conta</h2>
        <p className="suave">
          Seus dados pessoais serão anonimizados (LGPD). O saldo restante será perdido. Registros
          fiscais das compras são mantidos sem identificação.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmaExclusao}
            onChange={(e) => setConfirmaExclusao(e.target.checked)}
          />
          Entendo que vou perder meu saldo
        </label>
        <button
          className="botao perigo"
          disabled={!confirmaExclusao || acao.enviando}
          onClick={() => void excluir()}
        >
          Excluir conta
        </button>
      </section>
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <PerfilApp />
    </Suspense>
  );
}
