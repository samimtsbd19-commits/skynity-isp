import { describe, it, expect } from 'vitest';
import { getRadiusSecretForRouter } from '../src/services/radius.js';

describe('getRadiusSecretForRouter', () => {
  it('returns empty string when router is missing', () => {
    expect(getRadiusSecretForRouter(null)).toBe('');
    expect(getRadiusSecretForRouter(undefined)).toBe('');
  });

  it('prefers radius_secret_plain over radius_secret', () => {
    expect(
      getRadiusSecretForRouter({ radius_secret_plain: 'plain', radius_secret: 'fallback' }),
    ).toBe('plain');
  });

  it('falls back to radius_secret', () => {
    expect(getRadiusSecretForRouter({ radius_secret: 'sec' })).toBe('sec');
  });

  it('returns empty when only ciphertext is present but invalid', () => {
    expect(getRadiusSecretForRouter({ radius_secret_enc: 'not-valid-ciphertext' })).toBe('');
  });
});
