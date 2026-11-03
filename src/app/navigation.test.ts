import { describe, expect, it } from 'vitest';
import { readPage } from './navigation';

describe('readPage', () => {
  it.each(['overview', 'rounds', 'group'] as const)('recognizes #%s', (page) => {
    expect(readPage(`#${page}`)).toBe(page);
  });

  it.each(['', '#', '#unknown', '#Rounds', '#rounds/1', '#%67roup'])('falls back safely for %j', (hash) => {
    expect(readPage(hash)).toBe('overview');
  });
});
