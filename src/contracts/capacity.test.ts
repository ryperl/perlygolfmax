import { describe, expect, it } from 'vitest';
import { fictionalId, fictionalSetup } from '../client/catalog.test-support';
import { isEventSetupInput } from './setup';
import { isPrivateUpload, isPrivateUploadPart, maximumPrivateWriteBytes, privateWritePartBytes } from './private-values';

describe('capacity-independent setup and transport contracts', () => {
  it.each([12, 40, 124])('accepts %i unique golfers with manual group numbers beyond four while retaining complete assignment and foursome rules', (count) => {
    const players = Array.from({ length: count }, (_, index) => fictionalId(1000 + index));
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round');
    const groups = Array.from({ length: count / 4 }, (_, index) => ({ number: index + 100, playerIds: players.slice(index * 4, (index + 1) * 4) }));
    const input = { ...fictionalSetup, playerIds: players, rounds: [{ ...round, groups }] };
    expect(isEventSetupInput(input)).toBe(true);
    for (const invalid of [
      { ...input, playerIds: [...players, players[0]] },
      { ...input, rounds: [{ ...round, groups: groups.slice(1) }] },
      { ...input, rounds: [{ ...round, groups: [{ number: 1, playerIds: players }] }] },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((number) => ({ ...input, rounds: [{ ...round, groups: groups.map((group, index) => index ? group : { ...group, number }) }] })),
    ]) expect(isEventSetupInput(invalid)).toBe(false);
  });

  it('bounds manifest bytes, exact part count, indices and base64 independently of golfer counts', () => {
    const manifest = { id: fictionalId(1000), bytes: 100, parts: 1, sha256: 'a'.repeat(64) };
    expect(isPrivateUpload(manifest)).toBe(true);
    expect(isPrivateUpload({ ...manifest, bytes: maximumPrivateWriteBytes, parts: Math.ceil(maximumPrivateWriteBytes / privateWritePartBytes) })).toBe(true);
    for (const invalid of [null, {}, { ...manifest, bytes: 0 }, { ...manifest, bytes: maximumPrivateWriteBytes + 1 }, { ...manifest, parts: 2 }, { ...manifest, sha256: 'x'.repeat(64) }]) {
      expect(isPrivateUpload(invalid)).toBe(false);
    }
    expect(isPrivateUploadPart({ ...manifest, index: 0, content: 'RmljdGlvbmFs' })).toBe(true);
    for (const invalid of [{ ...manifest, index: -1, content: '' }, { ...manifest, index: 1, content: '' }, { ...manifest, index: 0, content: '%' }]) {
      expect(isPrivateUploadPart(invalid)).toBe(false);
    }
  });
});
