import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryTable } from '../test/catalog-fixtures.js';
import { creator, event } from '../test/fixtures.js';
import { canonical } from './catalog/entities.js';
import { privateContent, stagePrivateContent } from './private-values.js';

describe('immutable private content fragments', () => {
  it('reads legacy inline data unchanged and stores >100 fragments with bounded fenced transactions', async () => {
    const f = memoryTable();
    const inline = canonical({ fictional: 'legacy' });
    expect(await stagePrivateContent(f.table, event.id, 'workspace', creator, inline)).toBe(inline);
    expect(await privateContent(f.table, event.id, 'workspace', inline)).toBe(inline);
    const text = canonical({ fictional: '⛳ Fictional '.repeat(180_000) });
    const pointer = await stagePrivateContent(f.table, event.id, 'workspace', creator, text);
    expect(Buffer.byteLength(text, 'utf16le')).toBeGreaterThan(65536);
    expect(f.submit.mock.calls.length).toBeGreaterThan(100);
    expect(f.submit.mock.calls.every(([actions]) => actions.length === 2)).toBe(true);
    expect([...f.rows.values()].filter((row) => row.kind === 'private-fragment')
      .every((row) => typeof row.content === 'string' && Buffer.byteLength(row.content, 'utf16le') < 65536)).toBe(true);
    expect(await privateContent(f.table, event.id, 'workspace', pointer)).toBe(text);
    const rowCount = f.rows.size;
    expect(await stagePrivateContent(f.table, event.id, 'workspace', creator, text)).toBe(pointer);
    expect(f.rows.size).toBe(rowCount);
    await expect(privateContent(f.table, event.id, 'other-target', pointer)).rejects.toMatchObject({ code: 'INVALID_PRIVATE_VALUE' });
    await expect(privateContent(f.table, '00000000-0000-4000-8000-000000000099', 'workspace', pointer)).rejects.toMatchObject({ code: 'INVALID_PRIVATE_VALUE' });
  });

  it.each(['missing', 'hash', 'owner', 'index', 'base64', 'length'] as const)('rejects %s fragment corruption instead of returning partial data', async (failure) => {
    const f = memoryTable();
    const pointer = await stagePrivateContent(f.table, event.id, 'workspace', creator, canonical({ fictional: 'F'.repeat(70_000) }));
    const first = [...f.rows.entries()].find(([, row]) => row.kind === 'private-fragment');
    if (!first) throw new Error('Missing fictional fragment');
    const [key, row] = first;
    if (failure === 'missing') f.rows.delete(key);
    else {
      const content = failure === 'base64' ? '%' : failure === 'length' ? 'RmljdGlvbmFs' : row.content;
      f.seed({ ...row, ...(failure === 'owner' ? { ownerObjectId: event.id } : {}),
        ...(failure === 'index' ? { index: 99 } : {}), content,
        ...(failure === 'hash' ? { sha256: '0'.repeat(64) }
          : typeof content === 'string' ? { sha256: createHash('sha256').update(content).digest('hex') } : {}) });
    }
    await expect(privateContent(f.table, event.id, 'workspace', pointer)).rejects.toMatchObject({ status: 503 });
  });

  it('keeps failed staging inactive and resumes exact immutable fragments without hiding store errors', async () => {
    const f = memoryTable();
    const original = f.submit.getMockImplementation();
    if (!original) throw new Error('Missing fictional table implementation');
    let calls = 0;
    f.submit.mockImplementation((actions) => ++calls === 2 ? Promise.reject(new Error('Fictional fragment failure')) : original(actions));
    const text = canonical({ fictional: 'F'.repeat(70_000) });
    await expect(stagePrivateContent(f.table, event.id, 'workspace', creator, text)).rejects.toThrow('Fictional fragment failure');
    expect(f.rows.has(`${event.id}|workspace`)).toBe(false);
    expect([...f.rows.values()].filter((row) => row.kind === 'private-fragment')).toHaveLength(1);
    f.submit.mockImplementation(original);
    const pointer = await stagePrivateContent(f.table, event.id, 'workspace', creator, text);
    expect(await privateContent(f.table, event.id, 'workspace', pointer)).toBe(text);
    const first = [...f.rows.values()].find((row) => row.kind === 'private-fragment');
    if (!first) throw new Error('Missing fictional fragment');
    f.seed({ ...first, content: 'tampered' });
    await expect(stagePrivateContent(f.table, event.id, 'workspace', creator, text)).rejects.toMatchObject({ code: 'INVALID_PRIVATE_FRAGMENT' });
  });

  it('refuses late fragments after deletion claims the event, even when staging already read a writable fence', async () => {
    const f = memoryTable();
    f.seed({ partitionKey: event.id, rowKey: 'event-write-fence', state: 'writable' });
    const original = f.submit.getMockImplementation();
    if (!original) throw new Error('Missing fictional transaction');
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ partitionKey: event.id, rowKey: 'event-write-fence', state: 'blocked' });
      f.seed({ partitionKey: event.id, rowKey: 'event', status: 'deleted', kind: 'event-deletion' });
      return original(actions);
    });
    await expect(stagePrivateContent(f.table, event.id, 'workspace', creator, canonical({ fictional: 'F'.repeat(70_000) })))
      .rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
    expect([...f.rows.values()].some((row) => row.kind === 'private-fragment')).toBe(false);
  });
});
