import { createRoot } from 'react-dom/client';
import { EventLeaderboard } from '../../src/features/leaderboard';
import { overallView } from './overall-fixture-data';
import '../../src/app/styles.css';

const root = document.getElementById('overall-fixture');
if (!root) throw new Error('Missing fictional overall fixture root.');
createRoot(root).render(<div className="app"><main><EventLeaderboard value={overallView} /></main></div>);
