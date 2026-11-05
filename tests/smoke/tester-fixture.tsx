import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TesterEntry, TesterLinks } from '../../src/features/test-access';
import { fictionalTesterClient, fictionalTesterCredential } from './tester-fixture-data';
import '../../src/app/styles.css';

const root = document.getElementById('tester-fixture');
if (!root) throw new Error('Missing fictional tester fixture root.');
const client = fictionalTesterClient();
const owner = new URLSearchParams(window.location.search).has('owner');
const unexpectedExpiry = () => { throw new Error('Unexpected fictional owner expiry.'); };
export function Fixture() {
  const [exited, setExited] = useState(false);
  return <div className="app">
    {owner ? <main>
      <h1>Fictional tester management fixture</h1>
      <p>Isolated fictional UI. No actual access grants, messages or service requests.</p>
      <TesterLinks client={client} eventId={fictionalTesterCredential.eventId} onSessionExpired={unexpectedExpiry} />
    </main> : exited ? <p>Fictional tester access exited.</p>
      : <TesterEntry client={client} credential={fictionalTesterCredential} onExit={() => { setExited(true); }} />}
  </div>;
}
createRoot(root).render(<Fixture />);
