import { z } from 'zod';

const levelSchema = z.enum(['1', '2', '3', '4', '5', '6', '7', '7B']);

describe('validators', () => {
  it('acepta niveles permitidos', () => {
    expect(() => levelSchema.parse('7B')).not.toThrow();
  });

  it('rechaza niveles inválidos', () => {
    expect(() => levelSchema.parse('8')).toThrow();
  });
});

