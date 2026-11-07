import type { ReactNode } from 'react';

type ScoreAction = 'cards' | 'entry' | 'games' | 'leaderboard' | 'refresh';

const shapes: Readonly<Record<ScoreAction, ReactNode>> = {
  cards: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M3 14h18" /></>,
  entry: <><path d="m15 4 5 5M4 20l4-1L20 7a2.12 2.12 0 0 0-3-3L5 16l-1 4Z" /></>,
  games: <><path d="M5 21V3l13 4-13 4M3 21h4" /></>,
  leaderboard: <><path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v5m-4 4v-2h8v2M7 21h10" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
};

export function ScoreActionIcon({ kind }: { readonly kind: ScoreAction }) {
  return <svg className="score-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {shapes[kind]}
  </svg>;
}
