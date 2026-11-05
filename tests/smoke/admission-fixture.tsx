import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OwnerAccess, JoinAccess } from '../../src/features/admission';
import { fictionalAdmissionId, fictionalAdmissionsClient } from './admission-fixture-data';
import '../../src/app/styles.css';

const client = fictionalAdmissionsClient();
export function Fixture() {
  const [claimed, setClaimed] = useState(false);
  return <main style={{ padding: '1rem', maxWidth: '52rem', marginInline: 'auto', minWidth: 0 }}>
    <h1>Fictional admission layout fixture</h1>
    <p>Isolated fictional UI only. No invitations are delivered and no service grants are created.</p>
    <OwnerAccess client={client} eventId={fictionalAdmissionId(100)} onSessionExpired={() => { throw new Error('Unexpected fictional expiry.'); }} />
    <JoinAccess client={client} eventId={fictionalAdmissionId(100)} inviteId={fictionalAdmissionId(200)}
      token={claimed ? undefined : 'A'.repeat(43)} signedIn onClaimed={() => { setClaimed(true); }}
      onSessionExpired={() => { throw new Error('Unexpected fictional expiry.'); }} />
  </main>;
}
const root = document.getElementById('admission-fixture');
if (!root) throw new Error('Missing fictional admission fixture root.');
createRoot(root).render(<Fixture />);
