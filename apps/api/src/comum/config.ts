export const config = {
  get jwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === 'production')
        throw new Error('JWT_SECRET ausente ou curto (mínimo 32 caracteres)');
      return 'segredo-de-desenvolvimento-nao-usar-em-producao-000000';
    }
    return s;
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  },
  get porta() {
    return Number(process.env.PORT ?? 3001);
  },
  get cookieSeguro() {
    return process.env.COOKIE_SECURE === 'true';
  },
  get urlPublica() {
    return process.env.URL_PUBLICA ?? 'http://localhost:3000';
  },
  get pastaImportacao() {
    return process.env.PASTA_IMPORTACAO ?? './importacoes';
  },
  get pastaUploads() {
    return process.env.PASTA_UPLOADS ?? './uploads';
  },
  get notificador() {
    return process.env.NOTIFICADOR ?? 'console';
  },
  get ehTeste() {
    return process.env.NODE_ENV === 'test';
  },
};
