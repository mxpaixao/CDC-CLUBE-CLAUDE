'use client';
import { useState } from 'react';
import { Aviso, Carregando, Selo, Vazio } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { brl, data, mascararDoc } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';
import { pode, useUsuario } from '@/lib/painel';

interface Linha {
  id: string;
  status: string;
  nivel: string;
  codigo: string | null;
  especialidades: string[];
  bairros: string[];
  criadoEm: string;
  pessoa: { nome: string; cpf: string; telefone: string | null };
}
interface Detalhe {
  prestador: Linha & {
    cnpj: string | null;
    whatsapp: string | null;
    motivoStatus: string | null;
    aprovadoEm: string | null;
    fotos: string[];
    documentos: string[];
  };
  carteira: { saldos: { disponivelCentavos: number; pendenteCentavos: number } } | null;
  vendas: {
    id: string;
    lojaId: string;
    documentoErp: string;
    dataConfirmacao: string;
    baseCalculoCentavos: number;
    recompensaCentavos: number;
    recompensaExcedenteCentavos: number;
    status: string;
    origemIndicacao: string;
  }[];
  alertas: { id: string; tipo: string; descricao: string; status: string; criadoEm: string }[];
  qr: string | null;
  link: string | null;
}
const COR: Record<string, string> = {
  PENDENTE: 'alerta',
  APROVADO: 'ok',
  RECUSADO: 'erro',
  SUSPENSO: 'erro',
};

export default function Prestadores() {
  const [status, setStatus] = useState('PENDENTE');
  const [sel, setSel] = useState<string | null>(null);
  const lista = useDados<Linha[]>(`/prestadores${status ? `?status=${status}` : ''}`);
  if (sel)
    return (
      <DetalhePrestador
        id={sel}
        voltar={() => {
          setSel(null);
          void lista.recarregar();
        }}
      />
    );
  return (
    <div className="pilha">
      <h1>Prestadores</h1>
      <div className="abas" role="tablist">
        {['PENDENTE', 'APROVADO', 'SUSPENSO', 'RECUSADO', ''].map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            className={status === s ? 'ativa' : ''}
            onClick={() => setStatus(s)}
          >
            {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Todos'}
          </button>
        ))}
      </div>
      {lista.carregando && <Carregando />}
      <Aviso>{lista.erro?.message}</Aviso>
      {lista.dados?.length === 0 && (
        <Vazio>
          {status === 'PENDENTE'
            ? 'Nenhuma candidatura aguardando aprovação.'
            : 'Nenhum prestador.'}
        </Vazio>
      )}
      {!!lista.dados?.length && (
        <div className="cartao tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>Especialidades</th>
                <th>Bairros</th>
                <th>Nível</th>
                <th>Status</th>
                <th>Desde</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((p) => (
                <tr key={p.id}>
                  <td>{p.pessoa.nome}</td>
                  <td className="mono">{p.codigo ?? '—'}</td>
                  <td>{p.especialidades.join(', ')}</td>
                  <td>{p.bairros.join(', ')}</td>
                  <td>{p.nivel}</td>
                  <td>
                    <Selo tipo={COR[p.status]}>{p.status}</Selo>
                  </td>
                  <td>{data(p.criadoEm)}</td>
                  <td>
                    <button className="botao pequeno" onClick={() => setSel(p.id)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetalhePrestador({ id, voltar }: { id: string; voltar: () => void }) {
  const usuario = useUsuario();
  const { dados, erro, carregando, recarregar } = useDados<Detalhe>(`/prestadores/${id}`);
  const [nivel, setNivel] = useState('');
  const acao = useAcao();
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Aviso>{erro?.message}</Aviso>;
  const p = dados.prestador;
  const aprovar = () =>
    acao.executar(async () => {
      await api(`/prestadores/${id}/aprovar`, { body: {} });
      await recarregar();
    });
  const mudar = (acaoNome: 'recusar' | 'suspender') =>
    acao.executar(async () => {
      const motivo = window.prompt(`Motivo para ${acaoNome}:`);
      if (!motivo) return;
      await api(`/prestadores/${id}/${acaoNome}`, { body: { motivo } });
      await recarregar();
    });
  const definirNivel = () =>
    acao.executar(async () => {
      const motivo = window.prompt('Motivo da alteração de nível:', 'definição manual na Fase 1');
      if (!motivo) return;
      await api(`/prestadores/${id}/nivel`, { body: { nivel, motivo } });
      await recarregar();
    });

  return (
    <div className="pilha">
      <button className="botao secundario pequeno" onClick={voltar}>
        ← Voltar
      </button>
      <div className="duas-colunas">
        <div className="cartao pilha">
          <div className="linha entre">
            <h2>{p.pessoa.nome}</h2>
            <Selo tipo={COR[p.status]}>{p.status}</Selo>
          </div>
          <p className="suave">
            CPF {mascararDoc(p.pessoa.cpf)}
            {p.cnpj ? ` · CNPJ ${mascararDoc(p.cnpj)}` : ''} · WhatsApp {p.whatsapp ?? '—'}
          </p>
          <p>
            Especialidades: {p.especialidades.join(', ')}
            <br />
            Atende em: {p.bairros.join(', ')}
          </p>
          {p.motivoStatus && <Aviso tipo="alerta">{p.motivoStatus}</Aviso>}
          {pode(usuario, 'aprovacao_prestador') && (
            <div className="linha">
              {(p.status === 'PENDENTE' || p.status === 'SUSPENSO') && (
                <button className="botao" onClick={() => void aprovar()} disabled={acao.enviando}>
                  {p.status === 'SUSPENSO' ? 'Reativar' : 'Aprovar'}
                </button>
              )}
              {p.status === 'PENDENTE' && (
                <button className="botao perigo" onClick={() => void mudar('recusar')}>
                  Recusar
                </button>
              )}
              {p.status === 'APROVADO' && (
                <button className="botao perigo" onClick={() => void mudar('suspender')}>
                  Suspender
                </button>
              )}
            </div>
          )}
          {p.status === 'APROVADO' && pode(usuario, 'aprovacao_prestador') && (
            <div className="linha">
              <select
                style={{ width: 160 }}
                value={nivel || p.nivel}
                onChange={(e) => setNivel(e.target.value)}
                aria-label="Nível"
              >
                {['BRONZE', 'PRATA', 'OURO'].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <button
                className="botao secundario"
                onClick={() => void definirNivel()}
                disabled={!nivel || nivel === p.nivel}
              >
                Definir nível
              </button>
            </div>
          )}
          <Aviso>{acao.erro}</Aviso>
        </div>
        <div className="cartao pilha" style={{ textAlign: 'center' }}>
          {p.codigo ? (
            <>
              <div className="codigo-grande">{p.codigo}</div>
              {dados.qr && (
                <img
                  src={dados.qr}
                  alt={`QR de ${p.codigo}`}
                  width={180}
                  height={180}
                  style={{
                    margin: '0 auto',
                    display: 'block',
                    background: '#fff',
                    borderRadius: 8,
                  }}
                />
              )}
              <small className="mono">{dados.link}</small>
            </>
          ) : (
            <Vazio>Código gerado na aprovação.</Vazio>
          )}
          {dados.carteira && (
            <p>
              Recompensas: <strong>{brl(dados.carteira.saldos.disponivelCentavos)}</strong>{' '}
              disponíveis · {brl(dados.carteira.saldos.pendenteCentavos)} a liberar
            </p>
          )}
        </div>
      </div>
      {dados.alertas.length > 0 && (
        <section className="cartao">
          <h3>Alertas</h3>
          {dados.alertas.map((a) => (
            <Aviso key={a.id} tipo="alerta">
              {a.tipo}: {a.descricao} ({data(a.criadoEm)})
            </Aviso>
          ))}
        </section>
      )}
      <section className="cartao tabela-rolagem">
        <h3>Vendas indicadas</h3>
        {dados.vendas.length === 0 ? (
          <Vazio>Nenhuma venda indicada.</Vazio>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Loja/Doc</th>
                <th>Origem</th>
                <th className="direita">Base</th>
                <th className="direita">Recompensa</th>
                <th className="direita">Excedente teto</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dados.vendas.map((v) => (
                <tr key={v.id}>
                  <td>{data(v.dataConfirmacao)}</td>
                  <td className="mono">
                    {v.lojaId}/{v.documentoErp}
                  </td>
                  <td>{v.origemIndicacao}</td>
                  <td className="direita num">{brl(v.baseCalculoCentavos)}</td>
                  <td className="direita num">{brl(v.recompensaCentavos)}</td>
                  <td className="direita num">
                    {v.recompensaExcedenteCentavos ? brl(v.recompensaExcedenteCentavos) : '—'}
                  </td>
                  <td>{v.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
