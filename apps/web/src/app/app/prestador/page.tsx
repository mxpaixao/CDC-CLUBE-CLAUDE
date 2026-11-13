'use client';
import { useState } from 'react';
import { Aviso, Carregando, Selo, Vazio } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { brl, data, pct } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';

interface Area {
  prestador: {
    status: string;
    nivel: string;
    codigo: string | null;
    especialidades: string[];
    bairros: string[];
    motivoStatus: string | null;
  } | null;
  link?: string | null;
  qr?: string | null;
  percentualAtualBps?: number;
  tetoMensalCentavos?: number;
  recompensaNoMesCentavos?: number;
  carteira?: { saldos: { disponivelCentavos: number; pendenteCentavos: number } } | null;
  vendasIndicadas?: {
    data: string;
    comprador: string;
    valorCentavos: number;
    recompensaCentavos: number;
    status: string;
  }[];
}

export default function Prestador() {
  const { dados, erro, carregando, recarregar } = useDados<Area>('/app/prestador');
  if (carregando) return <Carregando />;
  if (erro) return <Aviso>{erro.message}</Aviso>;
  const p = dados?.prestador;
  if (!p || p.status === 'RECUSADO')
    return <Candidatura recusado={p?.motivoStatus ?? null} aoEnviar={recarregar} />;
  if (p.status === 'PENDENTE')
    return (
      <div className="cartao pilha">
        <h1>Cadastro em análise</h1>
        <p>Recebemos sua candidatura. A equipe CDC vai avaliar e avisar você pelo WhatsApp.</p>
        <Selo tipo="alerta">Pendente</Selo>
      </div>
    );
  if (p.status === 'SUSPENSO')
    return (
      <div className="cartao pilha">
        <h1>Cadastro suspenso</h1>
        <p>{p.motivoStatus}</p>
        <p className="suave">Fale com a equipe CDC.</p>
      </div>
    );

  const texto = `Compre na Casa das Correias com meu código ${p.codigo} e ganhe crédito no Clube CDC: ${dados?.link}`;
  return (
    <div className="pilha">
      <h1>Área do prestador</h1>
      <div className="cartao pilha" style={{ textAlign: 'center' }}>
        <div className="linha" style={{ justifyContent: 'center' }}>
          <Selo tipo="ok">Aprovado</Selo>
          <Selo tipo="info">
            Nível {p.nivel} · {pct(dados?.percentualAtualBps)}
          </Selo>
        </div>
        <div className="codigo-grande">{p.codigo}</div>
        {dados?.qr && (
          <img
            src={dados.qr}
            alt={`QR Code do código ${p.codigo}`}
            width={200}
            height={200}
            style={{ margin: '0 auto', display: 'block', background: '#fff', borderRadius: 8 }}
          />
        )}
        <a
          className="botao largo"
          href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
          target="_blank"
          rel="noreferrer"
        >
          Compartilhar no WhatsApp
        </a>
        <small className="suave">
          O cliente informa o código no caixa ANTES de fechar a compra.
        </small>
      </div>
      <div className="grade">
        <div className="cartao">
          <div className="kpi-rotulo">Disponível</div>
          <div className="kpi">{brl(dados?.carteira?.saldos.disponivelCentavos)}</div>
        </div>
        <div className="cartao">
          <div className="kpi-rotulo">A liberar</div>
          <div className="kpi">{brl(dados?.carteira?.saldos.pendenteCentavos)}</div>
        </div>
        <div className="cartao">
          <div className="kpi-rotulo">Recompensas no mês</div>
          <div className="kpi">{brl(dados?.recompensaNoMesCentavos)}</div>
          <small>Limite {brl(dados?.tetoMensalCentavos)}</small>
        </div>
      </div>
      <section className="cartao">
        <h2>Vendas indicadas</h2>
        {!dados?.vendasIndicadas?.length ? (
          <Vazio>Nenhuma venda indicada ainda.</Vazio>
        ) : (
          <ul className="lista-extrato">
            {dados.vendasIndicadas.map((v, i) => (
              <li key={i}>
                <div>
                  <strong>{v.comprador}</strong>
                  <div className="suave">
                    {data(v.data)} · compra de {brl(v.valorCentavos)}
                  </div>
                </div>
                <div className="num positivo">
                  {brl(v.recompensaCentavos)}
                  {v.status === 'CANCELADA' && (
                    <div>
                      <Selo tipo="erro">cancelada</Selo>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Candidatura({ recusado, aoEnviar }: { recusado: string | null; aoEnviar: () => void }) {
  const especialidades = useDados<{ id: string; nome: string }[]>('/prestadores/especialidades');
  const [f, setF] = useState({
    especialidades: [] as string[],
    bairros: '',
    whatsapp: '',
    cnpj: '',
    aceiteTermos: false,
    aceiteCodigoConduta: false,
    perfilPublico: false,
  });
  const { enviando, erro, executar } = useAcao();
  const alternar = (id: string) =>
    setF({
      ...f,
      especialidades: f.especialidades.includes(id)
        ? f.especialidades.filter((e) => e !== id)
        : [...f.especialidades, id],
    });
  const enviar = () =>
    executar(async () => {
      await api('/app/prestador/candidatura', {
        body: {
          especialidades: f.especialidades,
          bairros: f.bairros
            .split(',')
            .map((b) => b.trim())
            .filter(Boolean),
          whatsapp: f.whatsapp,
          cnpj: f.cnpj || null,
          aceiteTermos: f.aceiteTermos,
          aceiteCodigoConduta: f.aceiteCodigoConduta,
          perfilPublico: f.perfilPublico,
        },
      });
      aoEnviar();
    });
  return (
    <form
      className="cartao pilha"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <h1>Quero ser prestador CDC</h1>
      <p className="suave">
        Eletricistas, encanadores, pintores e outros profissionais ganham crédito CDC quando indicam
        clientes.
      </p>
      {recusado && (
        <Aviso tipo="alerta">
          Candidatura anterior recusada: {recusado}. Você pode enviar de novo.
        </Aviso>
      )}
      <fieldset className="cartao" style={{ boxShadow: 'none' }}>
        <legend className="suave">Especialidades</legend>
        {especialidades.dados?.map((e) => (
          <label key={e.id} className="check">
            <input
              type="checkbox"
              checked={f.especialidades.includes(e.id)}
              onChange={() => alternar(e.id)}
            />
            {e.nome}
          </label>
        ))}
      </fieldset>
      <label className="campo">
        Bairros/zonas onde atende (separe por vírgula)
        <input
          value={f.bairros}
          onChange={(e) => setF({ ...f, bairros: e.target.value })}
          placeholder="Cidade Nova, Centro, Zona Leste"
          required
        />
      </label>
      <label className="campo">
        WhatsApp
        <input
          inputMode="tel"
          value={f.whatsapp}
          onChange={(e) => setF({ ...f, whatsapp: e.target.value })}
          required
        />
      </label>
      <label className="campo">
        CNPJ/MEI (opcional)
        <input value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={f.aceiteTermos}
          onChange={(e) => setF({ ...f, aceiteTermos: e.target.checked })}
        />
        Aceito os termos do programa de prestadores
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={f.aceiteCodigoConduta}
          onChange={(e) => setF({ ...f, aceiteCodigoConduta: e.target.checked })}
        />
        Aceito o código de conduta (sem autoindicação, sem cobrança indevida ao cliente)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={f.perfilPublico}
          onChange={(e) => setF({ ...f, perfilPublico: e.target.checked })}
        />
        Aceito ter meu perfil exibido publicamente no futuro &quot;CDC Indica&quot; (opcional)
      </label>
      <button
        className="botao largo"
        disabled={enviando || !f.aceiteTermos || !f.aceiteCodigoConduta || !f.especialidades.length}
      >
        Enviar candidatura
      </button>
      <Aviso>{erro}</Aviso>
    </form>
  );
}
