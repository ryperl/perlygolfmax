import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PursePanelProps } from '../../src/features/purse';
import { PursePanel } from '../../src/features/purse';
import type { PursePlan } from '../../src/domain/purse';
import { purseTestId } from '../../src/domain/purse.test-support';
import { fictionalPurse, fictionalPurseSave } from './purse-fixture-data';
import '../../src/app/styles.css';

const initial = fictionalPurse(40, 'four-two-net', [4, 5, 6, 7, 5, 6, 7, 8]);
const original = initial.configuration.plan;
if (!original) throw new Error('Missing fictional plan.');
const plan: PursePlan = { ...original, funding: { kind: 'buy-in', buyInMinor: 25 }, pools: [
  { id: purseTestId(5100), name: 'Fictional side pot', source: { kind: 'manual' }, awardUnit: 'pot',
    amountMinor: 101, recipientIds: [purseTestId(1), purseTestId(13), purseTestId(40)] },
  ...original.pools,
] };
const initialValue = fictionalPurseSave(initial, plan, [], initial.configuration.etag, purseTestId(8100)).current;

export function Fixture() {
  const [value, setValue] = useState(initialValue);
  const [dirty, setDirty] = useState(false);
  const save: PursePanelProps['onSave'] = (next, resolutions, etag, id) => {
    const result = fictionalPurseSave(value, next, resolutions, etag, id);
    setValue(result.current);
    return Promise.resolve(result);
  };
  return <main style={{ padding: '1rem', maxWidth: '70rem', marginInline: 'auto', minWidth: 0 }}>
    <h1>Fictional purse layout fixture</h1><p role="status">{dirty ? 'Unsaved fictional purse draft' : 'Saved fictional purse'}</p>
    <PursePanel value={value} busy={false} onSave={save} onRefresh={() => Promise.resolve(value)} onDirtyChange={setDirty} />
  </main>;
}

const root = document.getElementById('purse-fixture');
if (!root) throw new Error('Missing fictional fixture root.');
createRoot(root).render(<Fixture />);
