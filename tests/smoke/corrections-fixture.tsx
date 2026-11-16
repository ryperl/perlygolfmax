import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoundCorrectionsDialog } from '../../src/features/corrections';
import { fictionalCorrection, fictionalCorrectionResult } from '../../src/features/corrections/corrections.test-support';
import type { RoundCorrectionsClient } from '../../src/client/round-corrections';
import '../../src/app/styles.css';

let model = fictionalCorrection();
const client: RoundCorrectionsClient = {
  load: () => Promise.resolve(model),
  save: (_event, _round, request) => {
    const result = fictionalCorrectionResult(model, request);
    model = result.model;
    return Promise.resolve(result);
  },
};
export function Fixture() {
  const [open, setOpen] = useState(true);
  return <main>{open ? <RoundCorrectionsDialog client={client} eventId={model.eventId} roundId={model.roundId}
    roundName="Fictional round" onClose={() => { setOpen(false); }} onSessionExpired={() => undefined} />
    : <h1>Returned to fictional scores</h1>}</main>;
}
const root = document.getElementById('corrections-fixture');
if (!root) throw new Error('Missing fictional corrections root');
createRoot(root).render(<Fixture />);
