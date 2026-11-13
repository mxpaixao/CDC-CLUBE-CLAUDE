import { expect, test, type Page } from '@playwright/test';
import { aguardarCodigo } from './util';

const nav = (page: Page, nome: string) =>
  page
    .getByRole('navigation', { name: 'Navegação do app' })
    .getByRole('link', { name: nome, exact: true });

test('adesão com OTP, consentimentos separados e área do app', async ({ page }) => {
  await page.goto('/app/aderir');
  await page.getByLabel('CPF', { exact: true }).fill('987.654.321-00');
  await page.getByLabel('Nome completo').fill('Cliente E2E');
  await page.getByLabel('Celular com DDD').fill('(92) 98877-6655');
  const botao = page.getByRole('button', { name: /Receber código/ });
  await expect(botao).toBeDisabled(); // adesão exige aceite explícito
  await page.getByText(/Li e aceito o/).click();
  await page.getByText('Avisos e ofertas por WhatsApp').click();
  const t0 = Date.now();
  await botao.click();
  await page.getByLabel('Código de 6 dígitos').fill(await aguardarCodigo('+5592988776655', t0));
  await page.getByRole('button', { name: 'Confirmar adesão' }).click();
  await expect(page.getByText('Saldo disponível')).toBeVisible();
  await page.getByRole('button', { name: 'Gerar código para o caixa' }).click();
  await expect(page.locator('.codigo-grande')).toHaveText(/^\d{6}$/);
  await nav(page, 'Regras').click();
  await expect(page.getByText(/pessoa física ganham 3% de volta/)).toBeVisible();
  await nav(page, 'Perfil').click();
  await expect(page.getByLabel('WhatsApp')).toBeChecked();
  await expect(page.getByLabel('SMS')).not.toBeChecked();
});

test('cliente existente entra com CPF + OTP e vê extrato com origem', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/entrar/);
  await page.getByLabel('CPF').fill('52998224725');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Receber código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill(await aguardarCodigo('+5592991110000', t0));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Olá, Maria!')).toBeVisible();
  await nav(page, 'Extrato').click();
  await expect(page.getByText('Boas-vindas').first()).toBeVisible();
});

test('prestador vê código, QR e link de compartilhamento', async ({ page }) => {
  await page.goto('/app/entrar');
  await page.getByLabel('CPF').fill('11144477735');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Receber código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill(await aguardarCodigo('+5592992220000', t0));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await nav(page, 'Prestador').click();
  await expect(page.locator('.codigo-grande')).toHaveText(/^CDC-JOAO[2-9]{2}$/);
  await expect(page.getByRole('img', { name: /QR Code/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Compartilhar no WhatsApp' })).toHaveAttribute(
    'href',
    /wa\.me/,
  );
});
