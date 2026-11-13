'use client';
import { useEffect, useState } from 'react';
import { Aviso, Carregando, Selo, Vazio } from '@/componentes/basicos';
import { api, novaChave } from '@/lib/api';
import { brl, dataHora, mascararDoc, reaisParaCentavos } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';
import { useUsuario } from '@/lib/painel';

interface CarteiraCaixa {
  id: string;
  tipo: 'CLIENTE' | 'PRESTADOR';
  empresa: { razaoSocial: string } | null;
  saldos: {
    disponivelCentavos: number;
    pendenteCentavos: number;
    reservadoCentavos: number;
    devedorCentavos: number;
  };
  limitePorCompraCentavos: number;
  maximoResgatavelCentavos: number;
  elegivel: boolean;
  motivo: string | null;
  exigeAutenticacaoTitular: boolean;
  saldoMinimoResgateCentavos: number;
}
interface Titular {
  nome: string;
  documento: string;
  tipo: string;
  participante: { status: string } | null;
  prestador: { status: string; codigo: string | null; nivel: string } | null;
  carteiras: CarteiraCaixa[];
}
interface Consulta {
  contingencia: { ativa: boolean; motivo: string | null };
  titulares: Titular[];
}
interface Reserva {
  id: string;
  codigo: string;
  valorCentavos: number;
  valorCompraCentavos: number;
  expiraEm: string;
  status: string;
  lojaId: string;
  criadoEm: string;
}

const MOTIVOS: Record<string, string> = {
  SALDO_DEVEDOR: 'Saldo devedor — resgate bloqueado até quitar',
  SALDO_ABAIXO_MINIMO: 'Saldo abaixo do mínimo para resgate',
  COMPRA_SEM_VALOR: 'Informe o valor da compra',
};

export default function Caixa() {
  const usuario = useUsuario();
  const lojas = useDados<{ id: string; nome: string }[]>('/lojas');
  const [loja, setLoja] = useState(usuario?.lojaId ?? '');
  const [busca, setBusca] = useState('');
  const [valorCompra, setValorCompra] = useState('');
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [carteira, setCarteira] = useState<CarteiraCaixa | null>(null);
  const [valorUsar, setValorUsar] = useState('');
  const [codigoTitular, setCodigoTitular] = useState('');
  const [liberacao, setLiberacao] = useState('');
  const [reserva, setReserva] = useState<Reserva | null>(null);
  const [docErp, setDocErp] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const abertas = useDados<Reserva[]>(loja ? `/reservas?lojaId=${loja}` : null);
  const acao = useAcao();

  useEffect(() => {
    if (!loja && lojas.dados?.[0]) setLoja(usuario?.lojaId ?? lojas.dados[0].id);
  }, [loja, lojas.dados, usuario]);

  const compraCentavos = reaisParaCentavos(valorCompra);
  const consultar = () =>
    acao.executar(async () => {
      setReserva(null);
      setCarteira(null);
      setMensagem(null);
      const r = await api<Consulta>(
        `/caixa/consulta?busca=${encodeURIComponent(busca)}${Number.isFinite(compraCentavos) && compraCentavos > 0 ? `&valorCompraCentavos=${compraCentavos}` : ''}`,
      );
      setConsulta(r);
      const primeira =
        r.titulares[0]?.carteiras.find((c) => c.elegivel) ?? r.titulares[0]?.carteiras[0] ?? null;
      escolher(primeira);
    });
  const escolher = (c: CarteiraCaixa | null) => {
    setCarteira(c);
    setValorUsar(
      c && c.maximoResgatavelCentavos > 0
        ? (c.maximoResgatavelCentavos / 100).toFixed(2).replace('.', ',')
        : '',
    );
    setCodigoTitular('');
  };
  const enviarOtp = () =>
    acao.executar(async () => {
      const r = await api<{ enviadoPara: string }>('/caixa/otp', {
        body: { carteiraId: carteira!.id },
      });
      setMensagem(`Código enviado para ${r.enviadoPara}. Peça ao titular.`);
    });
  const reservar = () =>
    acao.executar(async () => {
      const r = await api<Reserva>('/reservas', {
        idempotencia: novaChave(),
        body: {
          carteiraId: carteira!.id,
          valorCompraCentavos: compraCentavos,
          valorCentavos: reaisParaCentavos(valorUsar),
          lojaId: loja,
          codigoTitular: codigoTitular || null,
          liberacaoSupervisor: liberacao || null,
        },
      });
      setReserva(r);
      setMensagem(null);
      void abertas.recarregar();
    });
  const confirmar = (id: string) =>
    acao.executar(async () => {
      await api(`/reservas/${id}/confirmar`, { body: { vendaErpRef: docErp || null } });
      setMensagem('Resgate confirmado.');
      setReserva(null);
      setConsulta(null);
      setBusca('');
      setValorCompra('');
      setDocErp('');
      void abertas.recarregar();
    });
  const cancelar = (id: string) =>
    acao.executar(async () => {
      const motivo = window.prompt('Motivo do cancelamento:', 'cliente desistiu do uso do saldo');
      if (!motivo) return;
      await api(`/reservas/${id}/cancelar`, { body: { motivo } });
      if (reserva?.id === id) setReserva(null);
      setMensagem('Reserva cancelada; saldo liberado.');
      void abertas.recarregar();
    });

  return (
    <div className="pilha">
      <div className="painel-cabecalho">
        <h1>Caixa</h1>
        <label className="campo" style={{ width: 260 }}>
          Loja
          <select value={loja} onChange={(e) => setLoja(e.target.value)}>
            {lojas.dados?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="duas-colunas">
        <div className="pilha">
          <form
            className="cartao pilha"
            onSubmit={(e) => {
              e.preventDefault();
              void consultar();
            }}
          >
            <h2>1. Identificar cliente</h2>
            <label className="campo">
              CPF, CNPJ, telefone ou código/QR do prestador
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="000.000.000-00"
                required
              />
            </label>
            <label className="campo">
              Valor da compra em mercadorias (sem frete/serviços)
              <input
                inputMode="decimal"
                value={valorCompra}
                onChange={(e) => setValorCompra(e.target.value)}
                placeholder="0,00"
              />
            </label>
            <button className="botao" disabled={acao.enviando}>
              Consultar saldo
            </button>
          </form>

          {consulta && consulta.titulares.length === 0 && (
            <Aviso tipo="alerta">Nenhum participante encontrado. Ofereça a adesão ao Clube.</Aviso>
          )}
          {consulta?.titulares.map((t) => (
            <div key={t.documento} className="cartao pilha">
              <div className="linha entre">
                <div>
                  <strong>{t.nome}</strong>
                  <div className="suave">{mascararDoc(t.documento)}</div>
                </div>
                <div className="linha">
                  {t.participante ? (
                    <Selo tipo={t.participante.status === 'ATIVO' ? 'ok' : 'erro'}>
                      Participante {t.participante.status.toLowerCase()}
                    </Selo>
                  ) : (
                    <Selo tipo="alerta">Não participante</Selo>
                  )}
                  {t.prestador && (
                    <Selo tipo="info">Prestador {t.prestador.codigo ?? t.prestador.status}</Selo>
                  )}
                </div>
              </div>
              {t.carteiras.length === 0 && <Vazio>Sem carteira.</Vazio>}
              {t.carteiras.map((c) => (
                <label
                  key={c.id}
                  className="check cartao"
                  style={{
                    boxShadow: 'none',
                    borderColor: carteira?.id === c.id ? 'var(--cor-marca)' : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name="carteira"
                    checked={carteira?.id === c.id}
                    onChange={() => escolher(c)}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="linha entre">
                      <strong>
                        {c.tipo === 'PRESTADOR'
                          ? 'Carteira de prestador'
                          : c.empresa
                            ? `Empresa: ${c.empresa.razaoSocial}`
                            : 'Cashback do cliente'}
                      </strong>
                      <span className="num">{brl(c.saldos.disponivelCentavos)}</span>
                    </div>
                    <small>
                      Pode usar até <strong>{brl(c.maximoResgatavelCentavos)}</strong> nesta compra
                      (limite {brl(c.limitePorCompraCentavos)}) · a liberar{' '}
                      {brl(c.saldos.pendenteCentavos)}
                    </small>
                    {!c.elegivel && c.motivo && (
                      <div>
                        <Selo tipo="erro">{MOTIVOS[c.motivo] ?? c.motivo}</Selo>
                      </div>
                    )}
                    {c.exigeAutenticacaoTitular && (
                      <div>
                        <Selo tipo="alerta">Exige código do titular</Selo>
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          ))}

          {carteira && !reserva && (
            <form
              className="cartao pilha"
              onSubmit={(e) => {
                e.preventDefault();
                void reservar();
              }}
            >
              <h2>2. Reservar valor</h2>
              <label className="campo">
                Valor a usar (R$)
                <input
                  inputMode="decimal"
                  value={valorUsar}
                  onChange={(e) => setValorUsar(e.target.value)}
                  required
                />
              </label>
              {carteira.exigeAutenticacaoTitular ? (
                <div className="pilha">
                  <button
                    type="button"
                    className="botao secundario"
                    onClick={() => void enviarOtp()}
                    disabled={acao.enviando}
                  >
                    Enviar código ao titular (WhatsApp/SMS)
                  </button>
                  <label className="campo">
                    Código do titular (6 dígitos)
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      value={codigoTitular}
                      onChange={(e) => setCodigoTitular(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </label>
                </div>
              ) : (
                <label className="campo">
                  Código mostrado no app do cliente (opcional)
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={codigoTitular}
                    onChange={(e) => setCodigoTitular(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              )}
              {consulta?.contingencia.ativa && (
                <label className="campo">
                  Liberação do supervisor (justificativa)
                  <input
                    value={liberacao}
                    onChange={(e) => setLiberacao(e.target.value)}
                    placeholder="conferido manualmente no ERP por…"
                  />
                </label>
              )}
              <button
                className="botao"
                disabled={acao.enviando || !Number.isFinite(compraCentavos) || compraCentavos <= 0}
              >
                Reservar e gerar código de resgate
              </button>
              {(!Number.isFinite(compraCentavos) || compraCentavos <= 0) && (
                <small>Informe o valor da compra acima.</small>
              )}
            </form>
          )}

          {reserva && (
            <div className="cartao pilha">
              <h2>3. Lançar no ERP</h2>
              <p>
                Lance <strong>{brl(reserva.valorCentavos)}</strong> como forma de pagamento{' '}
                <em>“Crédito Clube CDC”</em> com o código:
              </p>
              <div className="codigo-grande" aria-live="polite">
                {reserva.codigo}
              </div>
              <small>
                Reserva válida até {dataHora(reserva.expiraEm)}. Sem confirmação, o saldo volta
                automaticamente.
              </small>
              <label className="campo">
                Nº do documento no ERP (opcional)
                <input value={docErp} onChange={(e) => setDocErp(e.target.value)} />
              </label>
              <div className="linha">
                <button
                  className="botao"
                  onClick={() => void confirmar(reserva.id)}
                  disabled={acao.enviando}
                >
                  Confirmar resgate
                </button>
                <button
                  className="botao perigo"
                  onClick={() => void cancelar(reserva.id)}
                  disabled={acao.enviando}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <Aviso tipo="ok">{mensagem}</Aviso>
          <Aviso>{acao.erro}</Aviso>
        </div>

        <div className="pilha">
          <section className="cartao">
            <h2>Reservas abertas nesta loja</h2>
            {abertas.carregando && <Carregando />}
            {abertas.dados?.length === 0 && <Vazio>Nenhuma reserva aberta.</Vazio>}
            {!!abertas.dados?.length && (
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th className="direita">Valor</th>
                    <th>Expira</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {abertas.dados.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.codigo}</td>
                      <td className="direita num">{brl(r.valorCentavos)}</td>
                      <td>{dataHora(r.expiraEm)}</td>
                      <td>
                        <div className="linha">
                          <button className="botao pequeno" onClick={() => void confirmar(r.id)}>
                            Confirmar
                          </button>
                          <button
                            className="botao perigo pequeno"
                            onClick={() => void cancelar(r.id)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <PreRegistro loja={loja} />
        </div>
      </div>
    </div>
  );
}

function PreRegistro({ loja }: { loja: string }) {
  const [documento, setDocumento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const acao = useAcao();
  const registrar = () =>
    acao.executar(async () => {
      const r = await api<{ codigo: string }>('/indicacoes/pre-registro', {
        body: { lojaId: loja, documentoErp: documento, codigo },
      });
      setOk(`Indicação de ${r.codigo} registrada para o documento ${documento}.`);
      setDocumento('');
      setCodigo('');
    });
  return (
    <form
      className="cartao pilha"
      onSubmit={(e) => {
        e.preventDefault();
        void registrar();
      }}
    >
      <h2>Indicação de prestador</h2>
      <p className="suave">
        Registre o código do prestador <strong>antes</strong> de fechar a venda (orçamento/pedido).
        Um indicador por venda.
      </p>
      <label className="campo">
        Nº do orçamento/pedido/documento no ERP
        <input value={documento} onChange={(e) => setDocumento(e.target.value)} required />
      </label>
      <label className="campo">
        Código ou QR do prestador
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="CDC-JOAO27"
          required
        />
      </label>
      <button className="botao secundario" disabled={acao.enviando || !loja}>
        Registrar indicação
      </button>
      <Aviso tipo="ok">{ok}</Aviso>
      <Aviso>{acao.erro}</Aviso>
    </form>
  );
}
