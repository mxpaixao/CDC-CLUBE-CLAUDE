'use client';
import { Fragment, useMemo, useState } from 'react';
import { Aviso, Carregando, Selo } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { brl, data, pct, percentualParaBps, reaisParaCentavos } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';
import { pode, useUsuario } from '@/lib/painel';

interface Versao {
  id: string;
  versao: number;
  parametros: unknown;
  ativa: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  motivo: string | null;
  criadoEm: string;
  vigente: boolean;
}
interface Regra {
  id: string;
  escopo: string;
  nome: string | null;
  chave: string;
  perfil: string | null;
  lojaId: string | null;
  canal: string | null;
  familia: string | null;
  subfamilia: string | null;
  sku: string | null;
  versoes: Versao[];
}

const ESCOPOS = [
  'PERFIL',
  'PROGRAMA',
  'FAMILIA',
  'SUBFAMILIA',
  'PRODUTO',
  'LOJA_CANAL',
  'MATRIZ',
  'PISO_MARGEM',
  'NIVEL_PRESTADOR',
];
const MODELOS: Record<string, unknown> = {
  FAMILIA: { elegivel: false },
  SUBFAMILIA: { cashbackBps: 200 },
  PRODUTO: { cashbackBps: 500 },
  LOJA_CANAL: { cashbackBps: 300 },
  PISO_MARGEM: { concessaoMaximaBps: 1500 },
};

export default function Regras() {
  const [aba, setAba] = useState<'regras' | 'nova' | 'campanha' | 'simulador'>('regras');
  const usuario = useUsuario();
  const regras = useDados<Regra[]>('/regras');
  return (
    <div className="pilha">
      <h1>Regras e campanhas</h1>
      <div className="abas" role="tablist">
        <button
          role="tab"
          className={aba === 'regras' ? 'ativa' : ''}
          onClick={() => setAba('regras')}
        >
          Regras vigentes e versões
        </button>
        {pode(usuario, 'alteracao_regras') && (
          <button
            role="tab"
            className={aba === 'nova' ? 'ativa' : ''}
            onClick={() => setAba('nova')}
          >
            Nova versão de regra
          </button>
        )}
        {pode(usuario, 'alteracao_regras') && (
          <button
            role="tab"
            className={aba === 'campanha' ? 'ativa' : ''}
            onClick={() => setAba('campanha')}
          >
            Nova campanha
          </button>
        )}
        <button
          role="tab"
          className={aba === 'simulador' ? 'ativa' : ''}
          onClick={() => setAba('simulador')}
        >
          Simulador
        </button>
      </div>
      {aba === 'regras' && (
        <ListaRegras
          regras={regras.dados}
          carregando={regras.carregando}
          erro={regras.erro?.message}
        />
      )}
      {aba === 'nova' && (
        <NovaVersao
          regras={regras.dados ?? []}
          aoSalvar={() => {
            void regras.recarregar();
            setAba('regras');
          }}
        />
      )}
      {aba === 'campanha' && (
        <NovaCampanha
          aoSalvar={() => {
            void regras.recarregar();
            setAba('regras');
          }}
        />
      )}
      {aba === 'simulador' && <Simulador />}
    </div>
  );
}

function alvo(r: Regra) {
  return (
    [
      r.perfil,
      r.familia && `família ${r.familia}`,
      r.subfamilia && `subfamília ${r.subfamilia}`,
      r.sku && `SKU ${r.sku}`,
      r.lojaId && `loja ${r.lojaId}`,
      r.canal && `canal ${r.canal}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'geral'
  );
}

function ListaRegras({
  regras,
  carregando,
  erro,
}: {
  regras: Regra[] | null;
  carregando: boolean;
  erro?: string;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  if (carregando) return <Carregando />;
  if (erro) return <Aviso>{erro}</Aviso>;
  return (
    <div className="cartao tabela-rolagem">
      <p className="suave">
        Precedência: produto &gt; subfamília &gt; família &gt; campanha ativa &gt; loja/canal &gt;
        regra geral do perfil. Editar cria uma nova versão; lançamentos antigos mantêm a versão com
        que foram calculados.
      </p>
      <table>
        <thead>
          <tr>
            <th>Escopo</th>
            <th>Alvo</th>
            <th>Versão vigente</th>
            <th>Vigência</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {regras?.map((r) => {
            const v = r.versoes.find((x) => x.vigente);
            return (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <Selo tipo="info">{r.escopo}</Selo>
                  </td>
                  <td>
                    {r.nome ? <strong>{r.nome}</strong> : null}{' '}
                    <span className="suave">{alvo(r)}</span>
                  </td>
                  <td>{v ? `v${v.versao}` : <Selo tipo="alerta">sem versão vigente</Selo>}</td>
                  <td>
                    {v
                      ? `${data(v.vigenciaInicio)}${v.vigenciaFim ? ` → ${data(v.vigenciaFim)}` : ''}`
                      : r.versoes[0]
                        ? `começa ${data(r.versoes[0].vigenciaInicio)}`
                        : '—'}
                  </td>
                  <td>
                    <button
                      className="botao secundario pequeno"
                      onClick={() => setAberta(aberta === r.id ? null : r.id)}
                    >
                      {aberta === r.id ? 'Fechar' : 'Ver versões'}
                    </button>
                  </td>
                </tr>
                {aberta === r.id && (
                  <tr>
                    <td colSpan={5}>
                      {r.versoes.map((x) => (
                        <div key={x.id} className="cartao" style={{ boxShadow: 'none' }}>
                          <div className="linha entre">
                            <strong>
                              v{x.versao} {x.vigente && <Selo tipo="ok">vigente</Selo>}{' '}
                              {!x.ativa && <Selo tipo="erro">desativa a regra</Selo>}
                            </strong>
                            <small>
                              desde {data(x.vigenciaInicio)} · criada {data(x.criadoEm)}
                            </small>
                          </div>
                          {x.motivo && <small className="suave">Motivo: {x.motivo}</small>}
                          <pre
                            className="mono"
                            style={{ fontSize: '0.8rem', overflowX: 'auto', margin: '6px 0 0' }}
                          >
                            {JSON.stringify(x.parametros, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NovaVersao({ regras, aoSalvar }: { regras: Regra[]; aoSalvar: () => void }) {
  const [escopo, setEscopo] = useState('FAMILIA');
  const [filtros, setFiltros] = useState({
    perfil: '',
    familia: '',
    subfamilia: '',
    sku: '',
    lojaId: '',
    canal: '',
  });
  const [inicio, setInicio] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ativa, setAtiva] = useState(true);
  const existente = useMemo(
    () =>
      regras.find(
        (r) =>
          r.escopo === escopo &&
          (!['PERFIL'].includes(escopo) || r.perfil === filtros.perfil) &&
          ['PROGRAMA', 'MATRIZ', 'NIVEL_PRESTADOR', 'PERFIL'].includes(escopo),
      ),
    [regras, escopo, filtros.perfil],
  );
  const [json, setJson] = useState(JSON.stringify(MODELOS.FAMILIA, null, 2));
  const acao = useAcao();
  const trocarEscopo = (e: string) => {
    setEscopo(e);
    const r = regras.find(
      (x) => x.escopo === e && ['PROGRAMA', 'MATRIZ', 'NIVEL_PRESTADOR'].includes(e),
    );
    setJson(
      JSON.stringify(r?.versoes.find((v) => v.vigente)?.parametros ?? MODELOS[e] ?? {}, null, 2),
    );
  };
  const salvar = () =>
    acao.executar(async () => {
      let parametros: unknown;
      try {
        parametros = JSON.parse(json);
      } catch {
        throw new Error('parâmetros: JSON inválido');
      }
      const f = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      await api('/regras/versoes', {
        body: {
          escopo,
          filtros: f,
          parametros,
          vigenciaInicio: inicio ? new Date(inicio).toISOString() : null,
          ativa,
          motivo,
        },
      });
      aoSalvar();
    });
  const campo = (k: keyof typeof filtros, rot: string) => (
    <label className="campo">
      {rot}
      <input value={filtros[k]} onChange={(e) => setFiltros({ ...filtros, [k]: e.target.value })} />
    </label>
  );
  return (
    <form
      className="cartao pilha"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="grade">
        <label className="campo">
          Escopo
          <select value={escopo} onChange={(e) => trocarEscopo(e.target.value)}>
            {ESCOPOS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          Perfil{escopo === 'PERFIL' ? ' (obrigatório)' : ' (vazio = clientes)'}
          <select
            value={filtros.perfil}
            onChange={(e) => {
              setFiltros({ ...filtros, perfil: e.target.value });
              if (escopo === 'PERFIL')
                setJson(
                  JSON.stringify(
                    regras
                      .find((r) => r.escopo === 'PERFIL' && r.perfil === e.target.value)
                      ?.versoes.find((v) => v.vigente)?.parametros ?? {},
                    null,
                    2,
                  ),
                );
            }}
          >
            <option value="">—</option>
            <option>CLIENTE_CPF</option>
            <option>CLIENTE_EMPRESA</option>
            <option>PRESTADOR</option>
          </select>
        </label>
        {(escopo === 'FAMILIA' || escopo === 'PISO_MARGEM') &&
          campo('familia', 'Família (código ERP)')}
        {escopo === 'SUBFAMILIA' && campo('subfamilia', 'Subfamília (código ERP)')}
        {escopo === 'PRODUTO' && campo('sku', 'SKU')}
        {escopo === 'LOJA_CANAL' && (
          <>
            {campo('lojaId', 'Loja (ex.: LOJA-01)')}
            {campo('canal', 'Canal (LOJA, TELEVENDAS, APP)')}
          </>
        )}
        <label className="campo">
          Início da vigência (vazio = agora)
          <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
      </div>
      {existente && (
        <small className="suave">
          Esta alteração cria a v{(existente.versoes[0]?.versao ?? 0) + 1} de “
          {existente.nome ?? existente.chave}”.
        </small>
      )}
      <label className="campo">
        Parâmetros (JSON validado pelo servidor; percentuais em bps: 300 = 3%)
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={12}
          spellCheck={false}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={!ativa} onChange={(e) => setAtiva(!e.target.checked)} />
        Esta versão DESATIVA a regra a partir da vigência
      </label>
      <label className="campo">
        Motivo da alteração (vai para a auditoria)
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} required />
      </label>
      <button className="botao" disabled={acao.enviando}>
        Criar nova versão
      </button>
      <Aviso>{acao.erro}</Aviso>
    </form>
  );
}

function NovaCampanha({ aoSalvar }: { aoSalvar: () => void }) {
  const [f, setF] = useState({
    nome: '',
    percentual: '5',
    familias: '',
    lojas: '',
    inicio: '',
    fim: '',
    acumulaComPromocao: true,
    motivo: '',
  });
  const acao = useAcao();
  const lista = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const salvar = () =>
    acao.executar(async () => {
      const bps = percentualParaBps(f.percentual);
      if (!Number.isFinite(bps)) throw new Error('percentual inválido');
      await api('/campanhas', {
        body: {
          nome: f.nome,
          inicio: new Date(f.inicio).toISOString(),
          fim: new Date(f.fim).toISOString(),
          motivo: f.motivo,
          parametros: {
            cashbackBps: bps,
            familias: lista(f.familias),
            lojas: lista(f.lojas),
            acumulaComPromocao: f.acumulaComPromocao,
          },
        },
      });
      aoSalvar();
    });
  return (
    <form
      className="cartao pilha"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="grade">
        <label className="campo">
          Nome
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
        </label>
        <label className="campo">
          Cashback (%)
          <input
            inputMode="decimal"
            value={f.percentual}
            onChange={(e) => setF({ ...f, percentual: e.target.value })}
            required
          />
        </label>
        <label className="campo">
          Famílias (vírgula; vazio = todas)
          <input value={f.familias} onChange={(e) => setF({ ...f, familias: e.target.value })} />
        </label>
        <label className="campo">
          Lojas (vírgula; vazio = todas)
          <input
            value={f.lojas}
            onChange={(e) => setF({ ...f, lojas: e.target.value })}
            placeholder="LOJA-01, LOJA-03"
          />
        </label>
        <label className="campo">
          Início
          <input
            type="datetime-local"
            value={f.inicio}
            onChange={(e) => setF({ ...f, inicio: e.target.value })}
            required
          />
        </label>
        <label className="campo">
          Fim
          <input
            type="datetime-local"
            value={f.fim}
            onChange={(e) => setF({ ...f, fim: e.target.value })}
            required
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={f.acumulaComPromocao}
          onChange={(e) => setF({ ...f, acumulaComPromocao: e.target.checked })}
        />
        Acumula com itens em promoção
      </label>
      <label className="campo">
        Motivo
        <input
          value={f.motivo}
          onChange={(e) => setF({ ...f, motivo: e.target.value })}
          minLength={5}
          required
        />
      </label>
      <button className="botao" disabled={acao.enviando}>
        Criar campanha
      </button>
      <Aviso>{acao.erro}</Aviso>
    </form>
  );
}

interface ItemSim {
  id: string;
  sku: string;
  familia: string;
  valor: string;
  desconto: string;
  tipo: string;
  emPromocao: boolean;
}
interface ResultadoSim {
  resultado: {
    baseCalculoCentavos: number;
    cashback: { valorCentavos: number; motivoZero: string | null; origem: string };
    indicacao: { valorCentavos: number; motivoZero: string | null };
    itens: {
      id: string;
      baseCentavos: number;
      cashbackBps: number;
      cashbackFonte: { descricao: string };
      indicacaoBps: number;
    }[];
  };
  alertasMargem: { familia: string; motivo: string }[];
}

function Simulador() {
  const [itens, setItens] = useState<ItemSim[]>([
    {
      id: '1',
      sku: 'SKU-1',
      familia: 'FERRAMENTAS',
      valor: '200,00',
      desconto: '0',
      tipo: 'MERCADORIA',
      emPromocao: false,
    },
  ]);
  const [ctx, setCtx] = useState({
    perfil: 'CLIENTE_CPF',
    lojaId: 'LOJA-01',
    canal: 'LOJA',
    pago: '0',
    boasVindas: false,
    nivel: '',
  });
  const [r, setR] = useState<ResultadoSim | null>(null);
  const acao = useAcao();
  const muda = (i: number, k: keyof ItemSim, v: string | boolean) =>
    setItens(itens.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const simular = () =>
    acao.executar(async () =>
      setR(
        await api<ResultadoSim>('/regras/simular', {
          body: {
            perfil: ctx.perfil,
            lojaId: ctx.lojaId,
            canal: ctx.canal,
            pagoComCashbackCentavos: reaisParaCentavos(ctx.pago) || 0,
            boasVindas: ctx.boasVindas,
            indicacao: ctx.nivel ? { nivel: ctx.nivel } : null,
            itens: itens.map((i) => ({
              id: i.id,
              sku: i.sku,
              familia: i.familia || null,
              tipo: i.tipo,
              valorBrutoCentavos: reaisParaCentavos(i.valor),
              descontoCentavos: reaisParaCentavos(i.desconto) || 0,
              emPromocao: i.emPromocao,
            })),
          },
        }),
      ),
    );
  return (
    <div className="pilha">
      <div className="cartao pilha">
        <h2>Quanto esta venda geraria?</h2>
        <div className="grade">
          <label className="campo">
            Perfil
            <select value={ctx.perfil} onChange={(e) => setCtx({ ...ctx, perfil: e.target.value })}>
              <option>CLIENTE_CPF</option>
              <option>CLIENTE_EMPRESA</option>
              <option>PRESTADOR</option>
            </select>
          </label>
          <label className="campo">
            Loja
            <input
              value={ctx.lojaId}
              onChange={(e) => setCtx({ ...ctx, lojaId: e.target.value })}
            />
          </label>
          <label className="campo">
            Pago com cashback (R$)
            <input value={ctx.pago} onChange={(e) => setCtx({ ...ctx, pago: e.target.value })} />
          </label>
          <label className="campo">
            Indicação
            <select value={ctx.nivel} onChange={(e) => setCtx({ ...ctx, nivel: e.target.value })}>
              <option value="">sem indicação</option>
              <option>BRONZE</option>
              <option>PRATA</option>
              <option>OURO</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={ctx.boasVindas}
            onChange={(e) => setCtx({ ...ctx, boasVindas: e.target.checked })}
          />
          Primeira compra (boas-vindas)
        </label>
        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Família</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Desconto</th>
                <th>Promo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((i, n) => (
                <tr key={n}>
                  <td style={{ width: 60 }}>
                    <input
                      value={i.id}
                      onChange={(e) => muda(n, 'id', e.target.value)}
                      aria-label="Item"
                    />
                  </td>
                  <td>
                    <input
                      value={i.sku}
                      onChange={(e) => muda(n, 'sku', e.target.value)}
                      aria-label="SKU"
                    />
                  </td>
                  <td>
                    <input
                      value={i.familia}
                      onChange={(e) => muda(n, 'familia', e.target.value)}
                      aria-label="Família"
                    />
                  </td>
                  <td>
                    <select
                      value={i.tipo}
                      onChange={(e) => muda(n, 'tipo', e.target.value)}
                      aria-label="Tipo"
                    >
                      <option>MERCADORIA</option>
                      <option>SERVICO</option>
                      <option>FRETE</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={i.valor}
                      onChange={(e) => muda(n, 'valor', e.target.value)}
                      aria-label="Valor"
                    />
                  </td>
                  <td>
                    <input
                      value={i.desconto}
                      onChange={(e) => muda(n, 'desconto', e.target.value)}
                      aria-label="Desconto"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={i.emPromocao}
                      onChange={(e) => muda(n, 'emPromocao', e.target.checked)}
                      aria-label="Em promoção"
                    />
                  </td>
                  <td>
                    <button
                      className="botao perigo pequeno"
                      onClick={() => setItens(itens.filter((_, j) => j !== n))}
                      type="button"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="linha">
          <button
            className="botao secundario"
            type="button"
            onClick={() =>
              setItens([
                ...itens,
                {
                  id: String(itens.length + 1),
                  sku: '',
                  familia: '',
                  valor: '0,00',
                  desconto: '0',
                  tipo: 'MERCADORIA',
                  emPromocao: false,
                },
              ])
            }
          >
            + Item
          </button>
          <button className="botao" onClick={() => void simular()} disabled={acao.enviando}>
            Simular
          </button>
        </div>
        <Aviso>{acao.erro}</Aviso>
      </div>
      {r && (
        <div className="cartao pilha">
          <div className="grade">
            <div>
              <div className="kpi-rotulo">Base de cálculo</div>
              <div className="kpi">{brl(r.resultado.baseCalculoCentavos)}</div>
            </div>
            <div>
              <div className="kpi-rotulo">Cashback do comprador</div>
              <div className="kpi">{brl(r.resultado.cashback.valorCentavos)}</div>
              <small>{r.resultado.cashback.motivoZero ?? r.resultado.cashback.origem}</small>
            </div>
            <div>
              <div className="kpi-rotulo">Recompensa do prestador</div>
              <div className="kpi">{brl(r.resultado.indicacao.valorCentavos)}</div>
              <small>{r.resultado.indicacao.motivoZero ?? ''}</small>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="direita">Base</th>
                <th>Cashback</th>
                <th>Regra aplicada</th>
                <th>Indicação</th>
              </tr>
            </thead>
            <tbody>
              {r.resultado.itens.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td className="direita num">{brl(i.baseCentavos)}</td>
                  <td>{pct(i.cashbackBps)}</td>
                  <td className="suave">{i.cashbackFonte.descricao}</td>
                  <td>{pct(i.indicacaoBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.alertasMargem.map((a) => (
            <Aviso key={a.familia} tipo="alerta">
              Piso de margem: família {a.familia} — {a.motivo}
            </Aviso>
          ))}
        </div>
      )}
    </div>
  );
}
