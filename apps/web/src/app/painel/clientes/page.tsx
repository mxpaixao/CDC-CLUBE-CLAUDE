'use client';
import { useState } from 'react';
import { Aviso, Carregando, Selo, SeloEstado, Vazio } from '@/componentes/basicos';
import { api, novaChave } from '@/lib/api';
import { brl, data, mascararDoc, ORIGENS, reaisParaCentavos } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';
import { pode, useUsuario } from '@/lib/painel';

interface Resultado {
  tipo: 'PESSOA' | 'EMPRESA';
  id: string;
  nome: string;
  documento: string;
  participante: { status: string } | null;
  prestador: { codigo: string | null; status: string } | null;
}
interface Carteira {
  id: string;
  tipo: string;
  saldos: {
    disponivelCentavos: number;
    pendenteCentavos: number;
    reservadoCentavos: number;
    devedorCentavos: number;
  };
}
interface Detalhe {
  pessoa?: { nome: string; cpf: string; telefone: string | null; email: string | null };
  empresa?: {
    razaoSocial: string;
    cnpj: string;
    compradores: { papel: string; pessoa: { nome: string; cpf: string } }[];
  };
  carteiras: Carteira[];
  compras: {
    id: string;
    documentoErp: string;
    lojaId: string;
    dataConfirmacao: string;
    baseCalculoCentavos: number;
    cashbackCentavos: number;
    perfilAplicado: string;
    status: string;
  }[];
  consentimentos?: Record<string, boolean>;
}
interface Lanc {
  id: string;
  data: string;
  origem: string;
  estado: string;
  valorCentavos: number;
  ehLote: boolean;
  motivo: string | null;
  venceEm: string | null;
  liberaEm: string | null;
}

export default function Clientes() {
  const usuario = useUsuario();
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [sel, setSel] = useState<Resultado | null>(null);
  const [novo, setNovo] = useState(false);
  const acao = useAcao();
  const buscar = () =>
    acao.executar(async () => {
      setSel(null);
      setResultados(await api<Resultado[]>(`/participantes?busca=${encodeURIComponent(busca)}`));
    });

  return (
    <div className="pilha">
      <div className="painel-cabecalho">
        <h1>Clientes (CPF e Empresa)</h1>
        {pode(usuario, 'cadastro') && (
          <button className="botao secundario" onClick={() => setNovo(!novo)}>
            {novo ? 'Fechar cadastro' : 'Cadastrar cliente na loja'}
          </button>
        )}
      </div>
      {novo && <CadastroLoja />}
      <form
        className="cartao linha"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar();
        }}
      >
        <input
          style={{ flex: 1, minWidth: 220 }}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="CPF, CNPJ, telefone ou nome"
          aria-label="Buscar cliente"
        />
        <button className="botao" disabled={acao.enviando || busca.length < 3}>
          Buscar
        </button>
      </form>
      <Aviso>{acao.erro}</Aviso>
      {resultados && resultados.length === 0 && <Vazio>Nenhum cliente encontrado.</Vazio>}
      {resultados && resultados.length > 0 && !sel && (
        <div className="cartao tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Documento</th>
                <th>Clube</th>
                <th>Prestador</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.id}>
                  <td>{r.nome}</td>
                  <td className="mono">{mascararDoc(r.documento)}</td>
                  <td>
                    {r.participante ? (
                      <SeloEstadoPart s={r.participante.status} />
                    ) : (
                      <Selo>não participa</Selo>
                    )}
                  </td>
                  <td>
                    {r.prestador ? `${r.prestador.codigo ?? ''} (${r.prestador.status})` : '—'}
                  </td>
                  <td>
                    <button className="botao pequeno" onClick={() => setSel(r)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <DetalheCliente r={sel} voltar={() => setSel(null)} />}
    </div>
  );
}

function SeloEstadoPart({ s }: { s: string }) {
  return <Selo tipo={s === 'ATIVO' ? 'ok' : 'erro'}>{s.toLowerCase()}</Selo>;
}

function DetalheCliente({ r, voltar }: { r: Resultado; voltar: () => void }) {
  const usuario = useUsuario();
  const { dados, erro, carregando, recarregar } = useDados<Detalhe>(
    `/participantes/${r.tipo}/${r.id}`,
  );
  const [carteira, setCarteira] = useState<string | null>(null);
  const extrato = useDados<{ itens: Lanc[] }>(
    carteira ? `/carteiras/${carteira}/lancamentos` : null,
  );
  const [ajuste, setAjuste] = useState({ valor: '', motivo: '', sinal: '+' });
  const acao = useAcao();
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Aviso>{erro?.message}</Aviso>;

  const lancarAjuste = () =>
    acao.executar(async () => {
      const v = reaisParaCentavos(ajuste.valor);
      if (!Number.isFinite(v) || v <= 0) throw new Error('valor inválido');
      await api(`/carteiras/${carteira}/ajustes`, {
        idempotencia: novaChave(),
        body: { valorCentavos: ajuste.sinal === '-' ? -v : v, motivo: ajuste.motivo },
      });
      setAjuste({ valor: '', motivo: '', sinal: '+' });
      await Promise.all([recarregar(), extrato.recarregar()]);
    });

  return (
    <div className="pilha">
      <button className="botao secundario pequeno" onClick={voltar}>
        ← Voltar
      </button>
      <div className="cartao">
        <h2>{dados.pessoa?.nome ?? dados.empresa?.razaoSocial}</h2>
        <p className="suave">
          {mascararDoc(dados.pessoa?.cpf ?? dados.empresa?.cnpj ?? '')}{' '}
          {dados.pessoa?.telefone ? `· ${dados.pessoa.telefone}` : ''}{' '}
          {dados.pessoa?.email ? `· ${dados.pessoa.email}` : ''}
        </p>
        {dados.consentimentos && (
          <p className="linha">
            {Object.entries(dados.consentimentos).map(([k, v]) => (
              <Selo key={k} tipo={v ? 'ok' : ''}>
                {k.replace('MARKETING_', '').replace('_', ' ').toLowerCase()}: {v ? 'sim' : 'não'}
              </Selo>
            ))}
          </p>
        )}
        {dados.empresa && (
          <p className="suave">
            Compradores:{' '}
            {dados.empresa.compradores
              .map((c) => `${c.pessoa.nome} (${c.papel.toLowerCase()})`)
              .join(', ')}
          </p>
        )}
      </div>
      <div className="grade">
        {dados.carteiras.map((c) => (
          <button
            key={c.id}
            className="cartao"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: carteira === c.id ? 'var(--cor-marca)' : undefined,
              font: 'inherit',
              color: 'inherit',
            }}
            onClick={() => setCarteira(c.id)}
          >
            <div className="kpi-rotulo">
              {c.tipo === 'PRESTADOR' ? 'Carteira de prestador' : 'Carteira de cliente'}
            </div>
            <div className="kpi">{brl(c.saldos.disponivelCentavos)}</div>
            <small>
              a liberar {brl(c.saldos.pendenteCentavos)} · reservado{' '}
              {brl(c.saldos.reservadoCentavos)}
              {c.saldos.devedorCentavos > 0 ? ` · devedor ${brl(c.saldos.devedorCentavos)}` : ''}
            </small>
          </button>
        ))}
      </div>
      {carteira && (
        <div className="duas-colunas">
          <section className="cartao tabela-rolagem">
            <h3>Extrato</h3>
            {extrato.carregando && <Carregando />}
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Estado</th>
                  <th className="direita">Valor</th>
                </tr>
              </thead>
              <tbody>
                {extrato.dados?.itens.map((l) => (
                  <tr key={l.id}>
                    <td>{data(l.data)}</td>
                    <td>
                      {ORIGENS[l.origem] ?? l.origem}
                      {l.motivo ? (
                        <div className="suave" style={{ fontSize: '0.8rem' }}>
                          {l.motivo}
                        </div>
                      ) : null}
                    </td>
                    <td>{l.ehLote ? <SeloEstado estado={l.estado} /> : ''}</td>
                    <td className={`direita num ${l.valorCentavos < 0 ? 'negativo' : 'positivo'}`}>
                      {brl(l.valorCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {pode(usuario, 'ajuste_saldo') && (
            <form
              className="cartao pilha"
              onSubmit={(e) => {
                e.preventDefault();
                void lancarAjuste();
              }}
            >
              <h3>Ajuste manual</h3>
              <div className="linha">
                <select
                  style={{ width: 90 }}
                  value={ajuste.sinal}
                  onChange={(e) => setAjuste({ ...ajuste, sinal: e.target.value })}
                  aria-label="Crédito ou débito"
                >
                  <option value="+">+ crédito</option>
                  <option value="-">− débito</option>
                </select>
                <input
                  style={{ flex: 1 }}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={ajuste.valor}
                  onChange={(e) => setAjuste({ ...ajuste, valor: e.target.value })}
                  aria-label="Valor"
                  required
                />
              </div>
              <label className="campo">
                Motivo (obrigatório, fica na auditoria)
                <input
                  value={ajuste.motivo}
                  onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })}
                  minLength={10}
                  required
                />
              </label>
              <button className="botao" disabled={acao.enviando}>
                Lançar ajuste
              </button>
              <Aviso>{acao.erro}</Aviso>
            </form>
          )}
        </div>
      )}
      <section className="cartao tabela-rolagem">
        <h3>Compras</h3>
        {dados.compras.length === 0 ? (
          <Vazio>Nenhuma compra importada.</Vazio>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Loja/Doc</th>
                <th>Perfil</th>
                <th className="direita">Base</th>
                <th className="direita">Cashback</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dados.compras.map((v) => (
                <tr key={v.id}>
                  <td>{data(v.dataConfirmacao)}</td>
                  <td className="mono">
                    {v.lojaId}/{v.documentoErp}
                  </td>
                  <td>{v.perfilAplicado}</td>
                  <td className="direita num">{brl(v.baseCalculoCentavos)}</td>
                  <td className="direita num">{brl(v.cashbackCentavos)}</td>
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

function CadastroLoja() {
  const [f, setF] = useState({
    tipo: 'CPF',
    cpf: '',
    nome: '',
    telefone: '',
    cnpj: '',
    razaoSocial: '',
    codigo: '',
    whatsapp: false,
    sms: false,
  });
  const [enviado, setEnviado] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const acao = useAcao();
  const otp = () =>
    acao.executar(async () =>
      setEnviado(
        (
          await api<{ enviadoPara: string }>('/participantes/equipe/adesao/otp', {
            body: { cpf: f.cpf, telefone: f.telefone },
          })
        ).enviadoPara,
      ),
    );
  const confirmar = () =>
    acao.executar(async () => {
      await api('/participantes/equipe/adesao', {
        body: {
          tipo: f.tipo,
          cpf: f.cpf,
          nome: f.nome,
          cnpj: f.tipo === 'EMPRESA' ? f.cnpj : null,
          razaoSocial: f.tipo === 'EMPRESA' ? f.razaoSocial : null,
          codigo: f.codigo,
          consentimentos: {
            ADESAO_PROGRAMA: true,
            MARKETING_WHATSAPP: f.whatsapp,
            MARKETING_SMS: f.sms,
          },
        },
      });
      setOk(`${f.nome} cadastrado(a) no Clube.`);
      setEnviado(null);
    });
  return (
    <form
      className="cartao pilha"
      onSubmit={(e) => {
        e.preventDefault();
        void (enviado ? confirmar() : otp());
      }}
    >
      <h2>Cadastro na loja</h2>
      <p className="suave">
        O cliente confirma a adesão com o código recebido no celular (consentimento explícito).
      </p>
      <div className="grade">
        <label className="campo">
          Tipo
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            <option value="CPF">Pessoa física</option>
            <option value="EMPRESA">Empresa</option>
          </select>
        </label>
        <label className="campo">
          CPF{f.tipo === 'EMPRESA' ? ' do responsável' : ''}
          <input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} required />
        </label>
        <label className="campo">
          Nome
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
        </label>
        <label className="campo">
          Celular
          <input
            value={f.telefone}
            onChange={(e) => setF({ ...f, telefone: e.target.value })}
            required
          />
        </label>
        {f.tipo === 'EMPRESA' && (
          <>
            <label className="campo">
              CNPJ
              <input
                value={f.cnpj}
                onChange={(e) => setF({ ...f, cnpj: e.target.value })}
                required
              />
            </label>
            <label className="campo">
              Razão social
              <input
                value={f.razaoSocial}
                onChange={(e) => setF({ ...f, razaoSocial: e.target.value })}
                required
              />
            </label>
          </>
        )}
      </div>
      <div className="linha">
        <span className="suave">Cliente aceita receber avisos por:</span>
        <label className="check">
          <input
            type="checkbox"
            checked={f.whatsapp}
            onChange={(e) => setF({ ...f, whatsapp: e.target.checked })}
          />
          WhatsApp
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={f.sms}
            onChange={(e) => setF({ ...f, sms: e.target.checked })}
          />
          SMS
        </label>
      </div>
      {enviado && (
        <label className="campo">
          Código enviado para {enviado}
          <input
            inputMode="numeric"
            maxLength={6}
            value={f.codigo}
            onChange={(e) => setF({ ...f, codigo: e.target.value.replace(/\D/g, '') })}
            required
          />
        </label>
      )}
      <button className="botao" disabled={acao.enviando}>
        {enviado ? 'Confirmar adesão' : 'Enviar código ao cliente'}
      </button>
      <Aviso tipo="ok">{ok}</Aviso>
      <Aviso>{acao.erro}</Aviso>
    </form>
  );
}
