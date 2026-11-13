/** Registro central de controllers e serviços de domínio (cresce a cada marco). */
import type { Type } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { CarteirasController } from './carteiras/carteiras.controller';

export const CONTROLLERS: Type[] = [AuthController, CarteirasController];
export const SERVICOS: Type[] = [];
