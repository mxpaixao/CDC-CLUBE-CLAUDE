import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

@Injectable()
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(valor: unknown, _meta: ArgumentMetadata): z.infer<T> {
    return this.schema.parse(valor);
  }
}

export const validar = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);
