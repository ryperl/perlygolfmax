export type ScoreFeedbackState = 'idle' | 'saved' | 'unsaved' | 'working' | 'attention';

export function ScoreSaveIndicator({ state, unsavedCount }: {
  readonly state: ScoreFeedbackState;
  readonly unsavedCount: number;
}) {
  const pending = `${String(unsavedCount)} unsaved ${unsavedCount === 1 ? 'score' : 'scores'}`;
  const label = state === 'working' ? `Updating scores${unsavedCount > 0 ? `; ${pending}` : ''}`
    : state === 'attention' ? `Scores need attention${unsavedCount > 0 ? `; ${pending}` : ''}`
      : unsavedCount > 0 ? pending : state === 'saved' ? 'Scores saved' : 'No unsaved scores';
  return <span className="score-save-indicator" data-state={state} role="status" aria-label={label}
    aria-live="polite" aria-atomic="true" title={label}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {state === 'working' ? <><circle cx="12" cy="12" r="9" opacity=".25" /><path d="M12 3a9 9 0 0 1 9 9" /></>
        : state === 'attention' ? <><path d="m12 3 10 18H2L12 3ZM12 9v4m0 4h.01" /></>
          : state === 'unsaved' ? <circle cx="12" cy="12" r="5" fill="currentColor" />
            : <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>}
    </svg>
    {unsavedCount > 0 && <span className="score-indicator-count" aria-hidden="true">{unsavedCount}</span>}
    <span className="score-indicator-label">{label}</span>
  </span>;
}
