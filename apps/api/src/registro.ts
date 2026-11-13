/** Registro central de controllers e serviços de domínio. */
import type { Provider, Type } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { CaixaController } from './carteiras/caixa.controller';
import { CaixaService } from './carteiras/caixa.service';
import { CarteirasController } from './carteiras/carteiras.controller';
import { ConciliacaoController } from './conciliacao/conciliacao.controller';
import { ConciliacaoService } from './conciliacao/conciliacao.service';
import { ERP_GATEWAY, ImportacaoArquivoAdapter } from './erp/erp-gateway';
import { ImportacoesController } from './importacoes/importacoes.controller';
import { ImportacoesService } from './importacoes/importacoes.service';
import { JobsService } from './jobs/jobs.service';
import { ParticipantesController } from './participantes/participantes.controller';
import { ParticipantesService } from './participantes/participantes.service';
import { PrestadoresController } from './prestadores/prestadores.controller';
import { PrestadoresService } from './prestadores/prestadores.service';
import { RegrasController } from './regras/regras.controller';
import { AdminController } from './relatorios/admin.controller';
import { RelatoriosService } from './relatorios/relatorios.service';
import { AlertasService } from './vendas/alertas.service';
import { SaudeController } from './saude.controller';
import { ProcessamentoVendasService } from './vendas/processamento.service';

export const CONTROLLERS: Type[] = [
  SaudeController,
  AuthController,
  CarteirasController,
  CaixaController,
  ParticipantesController,
  PrestadoresController,
  ImportacoesController,
  ConciliacaoController,
  RegrasController,
  AdminController,
];

export const SERVICOS: Provider[] = [
  AlertasService,
  ProcessamentoVendasService,
  ImportacoesService,
  CaixaService,
  ParticipantesService,
  PrestadoresService,
  ConciliacaoService,
  RelatoriosService,
  JobsService,
  // Fase 1: importação por arquivo. Trocar por ShxApiAdapter quando a API da SHX for liberada.
  { provide: ERP_GATEWAY, useClass: ImportacaoArquivoAdapter },
];
