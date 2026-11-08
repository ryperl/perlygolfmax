import { describe, expect, it } from 'vitest';
import { churchyEnabled } from './config.js';

describe('optional Churchy experiment configuration', () => {
  it('defaults on independently of deployment-required identity and storage settings', () => {
    expect(churchyEnabled({})).toBe(true);
    expect(churchyEnabled({ CHURCHY_GAME_ENABLED: 'true' })).toBe(true);
  });
  it.each(['false', '', 'TRUE', 'FALSE', '0', 'typo'])('fails closed for configured value %j', (value) => {
    expect(churchyEnabled({ CHURCHY_GAME_ENABLED: value })).toBe(false);
  });
  it('re-evaluates an explicit kill switch when the runtime reads the environment again', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(churchyEnabled(env)).toBe(true);
    env.CHURCHY_GAME_ENABLED = 'false';
    expect(churchyEnabled(env)).toBe(false);
    env.CHURCHY_GAME_ENABLED = 'true';
    expect(churchyEnabled(env)).toBe(true);
  });
});
