import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CAIXA, aguardarCodigo } from './util';

async function entrar(page: Page, u: { email: string; senha: string }) {
  await page.goto('/painel/entrar');
  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha').fill(u.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('visão geral carrega indicadores para o administrador', async ({ page }) => {
  await entrar(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(page.getByText('Participantes ativos')).toBeVisible();
  await expect(page.getByText('Saldo em aberto (passivo)')).toBeVisible();
});

test('operador de caixa: consulta, limite de 20%, reserva com código e confirmação', async ({
  page,
}) => {
  await entrar(page, CAIXA);
  await expect(page.getByRole('heading', { name: 'Caixa' })).toBeVisible();
  // perfil de caixa não vê abas de regras/usuários
  await expect(page.getByRole('link', { name: 'Regras e campanhas' })).toHaveCount(0);
  await page.getByLabel('CPF, CNPJ, telefone ou código/QR do prestador').fill('529.982.247-25');
  await page.getByLabel(/Valor da compra/).fill('100,00');
  await page.getByRole('button', { name: 'Consultar saldo' }).click();
  await expect(page.getByText('Maria Fictícia da Silva')).toBeVisible();
  await expect(page.getByText(/limite R\$ 20,00/)).toBeVisible();
  await page.getByLabel('Valor a usar (R$)').fill('20,01');
  await page.getByRole('button', { name: /Reservar/ }).click();
  await expect(page.locator('.aviso.erro')).toContainText('limite');
  await page.getByLabel('Valor a usar (R$)').fill('10,00');
  await page.getByRole('button', { name: /Reservar/ }).click();
  const codigo = await page.locator('.codigo-grande').innerText();
  expect(codigo).toMatch(/^R[2-9A-Z]{7}$/);
  await page.getByLabel('Nº do documento no ERP (opcional)').fill('E2E-0001');
  await page.getByRole('button', { name: 'Confirmar resgate' }).click();
  await expect(page.getByText('Resgate confirmado.')).toBeVisible();
});

test('carteira de prestador exige código do titular', async ({ page }) => {
  await entrar(page, ADMIN);
  await page.getByRole('link', { name: 'Caixa' }).click();
  await page.getByLabel('CPF, CNPJ, telefone ou código/QR do prestador').fill('111.444.777-35');
  await page.getByLabel(/Valor da compra/).fill('500,00');
  await page.getByRole('button', { name: 'Consultar saldo' }).click();
  await page.getByText('Carteira de prestador').click();
  await expect(page.getByText('Exige código do titular').first()).toBeVisible();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Enviar código ao titular/ }).click();
  await expect(page.getByText(/Código enviado/)).toBeVisible();
  await page
    .getByLabel('Código do titular (6 dígitos)')
    .fill(await aguardarCodigo('+5592992220000', t0));
  await page.getByLabel('Valor a usar (R$)').fill('5,00');
  await page.getByRole('button', { name: /Reservar/ }).click();
  await expect(page.locator('.codigo-grande')).toBeVisible();
});

test('regras: simulador aplica regra geral e nova versão de família fica auditada', async ({
  page,
}) => {
  await entrar(page, ADMIN);
  await page.getByRole('link', { name: 'Regras e campanhas' }).click();
  await page.getByRole('tab', { name: 'Nova versão de regra' }).click();
  await page.getByLabel('Família (código ERP)').fill('CIMENTO');
  await page.getByLabel(/Motivo da alteração/).fill('margem baixa no cimento (E2E)');
  await page.getByRole('button', { name: 'Criar nova versão' }).click();
  await expect(page.getByText('família CIMENTO')).toBeVisible();
  await page.getByRole('tab', { name: 'Simulador' }).click();
  await page.getByLabel('Família').first().fill('CIMENTO');
  await page.getByRole('button', { name: 'Simular' }).click();
  await expect(page.getByText('família CIMENTO não elegível')).toBeVisible();
  await page.getByRole('link', { name: 'Usuários e auditoria' }).click();
  await page.getByRole('tab', { name: 'Trilha de auditoria' }).click();
  await expect(page.getByText('REGRA_NOVA_VERSAO').first()).toBeVisible();
});

test('importação de arquivo do ERP é idempotente', async ({ page }) => {
  await entrar(page, ADMIN);
  await page.getByRole('link', { name: 'Importação e conciliação' }).click();
  const csv =
    'tipo_movimento;loja;documento;data;comprador_documento;item;sku;valor_bruto;desconto\nVENDA;03;E2E-500;10/11/2026 10:00;52998224725;1;MART;250,00;0\n';
  const enviar = async () => {
    await page
      .getByLabel('Arquivo')
      .setInputFiles({ name: 'vendas-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Importar' }).click();
  };
  await enviar();
  await expect(page.getByText(/1 vendas novas/)).toBeVisible();
  await enviar();
  await expect(page.getByText(/0 vendas novas · 1 já importadas/)).toBeVisible();
});
