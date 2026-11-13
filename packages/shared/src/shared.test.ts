import { describe, expect, it } from 'vitest';
import {
  AcumuladorBps,
  aplicarBpsFloor,
  calcularLiberaEm,
  calcularVenceEm,
  cnpjValido,
  cpfValido,
  dataLocal,
  dentroDoHorarioComercial,
  diasCivisEntre,
  formatarBps,
  formatarBRL,
  gerarCnpjValido,
  gerarCodigoPrestador,
  gerarCodigoResgate,
  gerarCpfValido,
  identificarDocumento,
  intervaloMesCivil,
  mesCivilLocal,
  normalizarCodigoPrestador,
  normalizarTelefone,
  parseValorMonetario,
  proporcaoFloor,
  proximoHorarioComercial,
  ratearProporcional,
  somarCentavos,
  validarParametros,
} from './index';

describe('dinheiro', () => {
  it('aplica bps com floor e precisão total', () => {
    expect(aplicarBpsFloor(20000, 300)).toBe(600);
    expect(aplicarBpsFloor(4999, 300)).toBe(149); // 149,97 → 149
    expect(aplicarBpsFloor(1, 9999)).toBe(0);
  });
  it('acumula vários itens e arredonda uma única vez', () => {
    const acc = new AcumuladorBps().adicionar(333, 300).adicionar(333, 300).adicionar(334, 300);
    expect(acc.resultadoFloor()).toBe(30); // 30,00 exatos; floor por item daria 9+9+10=28
    expect(acc.bruto()).toBe(300000n);
  });
  it('rejeita float e base negativa', () => {
    expect(() => aplicarBpsFloor(10.5, 300)).toThrow();
    expect(() => aplicarBpsFloor(100, 300.5)).toThrow();
    expect(() => aplicarBpsFloor(-1, 300)).toThrow();
    expect(() => aplicarBpsFloor(100, 10001)).toThrow();
  });
  it('rateia pelo método dos maiores restos e fecha a soma', () => {
    expect(ratearProporcional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(ratearProporcional(1000, [5000, 3000, 2000])).toEqual([500, 300, 200]);
    const r = ratearProporcional(9999, [3333, 3333, 3334]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(9999);
    expect(ratearProporcional(0, [0, 0])).toEqual([0, 0]);
    expect(() => ratearProporcional(10, [0, 0])).toThrow();
    expect(() => ratearProporcional(10, [-1, 2])).toThrow();
  });
  it('proporção com floor', () => {
    expect(proporcaoFloor(1000, 1, 3)).toBe(333);
    expect(() => proporcaoFloor(1000, 1, 0)).toThrow();
    expect(() => proporcaoFloor(-1, 1, 2)).toThrow();
  });
  it('soma com segurança', () => {
    expect(somarCentavos([1, 2, 3])).toBe(6);
    expect(() => somarCentavos([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it('faz parse de valores brasileiros sem float', () => {
    expect(parseValorMonetario('R$ 1.234,56')).toBe(123456);
    expect(parseValorMonetario('49,99')).toBe(4999);
    expect(parseValorMonetario('50')).toBe(5000);
    expect(parseValorMonetario('0,1')).toBe(10);
    expect(parseValorMonetario('-10,50')).toBe(-1050);
    expect(parseValorMonetario('(3,00)')).toBe(-300);
    expect(parseValorMonetario('1234.56', 'ponto')).toBe(123456);
    expect(parseValorMonetario('1,234.56', 'ponto')).toBe(123456);
    expect(parseValorMonetario('10,5000')).toBe(1050);
    expect(parseValorMonetario(0.1 + 0.2)).toBe(30);
    expect(parseValorMonetario(49.99)).toBe(4999);
    expect(() => parseValorMonetario('10,555')).toThrow();
    expect(() => parseValorMonetario('abc')).toThrow();
    expect(() => parseValorMonetario('')).toThrow();
    expect(() => parseValorMonetario(Number.NaN)).toThrow();
  });
  it('formata', () => {
    expect(formatarBRL(123456)).toBe('R$ 1.234,56');
    expect(formatarBRL(-5)).toBe('-R$ 0,05');
    expect(formatarBps(300)).toBe('3%');
    expect(formatarBps(250)).toBe('2,5%');
    expect(formatarBps(125)).toBe('1,25%');
  });
});

describe('documentos', () => {
  it('valida CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido(gerarCpfValido('123456789'))).toBe(true);
  });
  it('valida CNPJ numérico e alfanumérico', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true); // exemplo oficial RFB
    expect(cnpjValido(gerarCnpjValido('AB1234CD0001'))).toBe(true);
    expect(cnpjValido('00000000000000')).toBe(false);
  });
  it('identifica documento', () => {
    expect(identificarDocumento('529.982.247-25')).toEqual({ tipo: 'CPF', valor: '52998224725' });
    expect(identificarDocumento('11.222.333/0001-81')?.tipo).toBe('CNPJ');
    expect(identificarDocumento('123')).toBeNull();
  });
  it('normaliza telefone', () => {
    expect(normalizarTelefone('(92) 99123-4567')).toBe('+5592991234567');
    expect(normalizarTelefone('+55 92 3232-1234')).toBe('+559232321234');
    expect(normalizarTelefone('92 81234567')).toBe('+559281234567');
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone('(92) 89123-4567')).toBeNull();
  });
});

describe('tempo (America/Manaus)', () => {
  it('usa a data civil de Manaus, não a de UTC', () => {
    // 2026-03-10 23:30 em Manaus = 2026-03-11 03:30Z
    const confirmacao = new Date('2026-03-11T03:30:00Z');
    expect(dataLocal(confirmacao)).toBe('2026-03-10');
    const libera = calcularLiberaEm(confirmacao, 7);
    expect(libera.toISOString()).toBe('2026-03-17T04:00:00.000Z'); // 17/03 00:00 Manaus
    const vence = calcularVenceEm(libera, 30);
    expect(vence.toISOString()).toBe('2026-04-17T03:59:59.999Z'); // 16/04 23:59:59.999 Manaus
  });
  it('mês civil local', () => {
    const virada = new Date('2026-04-01T02:00:00Z'); // 31/03 22:00 Manaus
    expect(mesCivilLocal(virada)).toBe('2026-03');
    const { inicio, fim } = intervaloMesCivil(virada);
    expect(inicio.toISOString()).toBe('2026-03-01T04:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-04-01T04:00:00.000Z');
  });
  it('dias civis e horário comercial', () => {
    expect(diasCivisEntre(new Date('2026-03-11T03:30:00Z'), new Date('2026-03-11T05:00:00Z'))).toBe(
      1,
    );
    const janela = { inicio: '08:00', fim: '18:00', diasSemana: [1, 2, 3, 4, 5, 6] };
    expect(dentroDoHorarioComercial(new Date('2026-03-10T14:00:00Z'), janela)).toBe(true); // ter 10:00
    expect(dentroDoHorarioComercial(new Date('2026-03-10T23:00:00Z'), janela)).toBe(false); // ter 19:00
    expect(dentroDoHorarioComercial(new Date('2026-03-15T14:00:00Z'), janela)).toBe(false); // domingo
    expect(proximoHorarioComercial(new Date('2026-03-10T23:00:00Z'), janela).toISOString()).toBe(
      '2026-03-11T12:00:00.000Z',
    );
    const dentro = new Date('2026-03-10T14:00:00Z');
    expect(proximoHorarioComercial(dentro, janela)).toBe(dentro);
  });
});

describe('códigos', () => {
  it('gera código de prestador legível', () => {
    const seq = [0, 5];
    let i = 0;
    const rnd = () => seq[i++ % seq.length];
    expect(gerarCodigoPrestador('João da Silva', 0, rnd)).toBe('CDC-JOAO27');
    expect(gerarCodigoPrestador('Maximiliano', 0, rnd)).toMatch(/^CDC-MAXIMI[2-9]{2}$/);
    expect(gerarCodigoPrestador('Ana', 20)).toMatch(/^CDC-ANA[2-9]{4}$/);
    expect(gerarCodigoPrestador('123')).toMatch(/^CDC-PRO[2-9]{2}$/);
  });
  it('normaliza leitura com 0/O e 1/I', () => {
    expect(normalizarCodigoPrestador('cdc j0a027')).toBe('CDC-JOAO27');
    expect(normalizarCodigoPrestador('CDC-JOAO27')).toBe('CDC-JOAO27');
    expect(normalizarCodigoPrestador('1VAN')).toBe('CDC-IVAN');
  });
  it('gera código de resgate sem caracteres ambíguos', () => {
    for (let i = 0; i < 50; i++) expect(gerarCodigoResgate()).toMatch(/^R[2-9A-HJKMNP-Z]{7}$/);
  });
});

describe('schemas de regra', () => {
  it('valida sobrescrita', () => {
    expect(validarParametros('FAMILIA', { elegivel: false })).toEqual({ elegivel: false });
    expect(() => validarParametros('FAMILIA', {})).toThrow();
    expect(() => validarParametros('PRODUTO', { cashbackBps: 10_001 })).toThrow();
  });
});
