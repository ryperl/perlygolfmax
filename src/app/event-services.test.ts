import { describe, expect, it } from 'vitest';
import { configureEventServices } from './event-services';

describe('event service composition', () => {
  it('does not instantiate identity or persistence when configuration is absent or invalid', () => {
    expect(configureEventServices({})).toEqual({ services: undefined });
    const invalid = configureEventServices({ VITE_API_URL: 'not-a-url' });
    expect(invalid.services).toBeUndefined();
    expect(invalid.configurationError).toContain('invalid');
  });
});
