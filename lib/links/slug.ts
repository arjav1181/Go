import { randomBytes } from 'node:crypto';
import { isReservedSlug } from './validation';

export function generateRandomSlug(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  if (isReservedSlug(result)) return generateRandomSlug(length);
  return result;
}
