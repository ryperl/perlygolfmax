import { createRoot } from 'react-dom/client';
import { RoundDifferentials } from '../../src/features/differentials';
import '../../src/app/styles.css';

const root = document.getElementById('differential-help-fixture');
if (!root) throw new Error('Missing fictional differential help fixture.');
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
createRoot(root).render(<div className="app"><main>
  <RoundDifferentials players={[
    { playerId: first, displayName: 'Fictional golfer 1' },
    { playerId: second, displayName: 'Fictional golfer 2' },
  ]} values={[
    { playerId: first, method: 'estimated-18-hole', pcc: 0, status: 'available', adjustedGross: 88, differentialTenths: 139 },
    { playerId: second, method: 'estimated-18-hole', pcc: 0, status: 'pending', adjustedGross: null,
      differentialTenths: null, reason: 'incomplete-card' },
  ]} />
  <button type="button">Outside the summary</button>
</main></div>);
