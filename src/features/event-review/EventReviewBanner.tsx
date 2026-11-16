import type { EventReviewNotice } from '../../domain/event-review';
import './event-review.css';

const messages: Readonly<Record<EventReviewNotice['code'], string>> = {
  'prize-tie': 'Resolve the prize tie',
  'kp-tie': 'Resolve the closest-to-pin tie',
  'stale-decision': 'Review a decision after its inputs changed',
  'stale-teams': 'Repair competition teams',
  'unavailable-inputs': 'Review unavailable calculation inputs',
  'budget-exceeded': 'Purse exceeds its budget',
  'unassigned-awards': 'Review unassigned prize money',
};
export function EventReviewBanner({ notices }: { readonly notices: readonly EventReviewNotice[] }) {
  if (!notices.length) return null;
  return <aside className="event-review-banner" aria-label="Organizer review needed">
    <details>
      <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
        <path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v1" />
      </svg><span role="status">Organizer review needed · {notices.length}</span></summary>
      <ul>{notices.map((notice) => <li key={`${notice.code}:${notice.contextId ?? ''}:${notice.label}`}><strong>{notice.label}</strong>: {messages[notice.code]}</li>)}</ul>
    </details>
  </aside>;
}
