import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Publico } from './auth/decoradores';
import { PrismaService } from './comum/prisma.service';

@ApiTags('saude')
@Controller('saude')
export class SaudeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Healthcheck (Docker/nginx): API no ar e banco respondendo. */
  @Publico()
  @Get()
  async saude() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, em: new Date().toISOString() };
  }
}
