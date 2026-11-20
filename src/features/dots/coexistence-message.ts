import type { DotsDeclarationIssue } from '../../domain/dots';

export function coexistenceMessage(issue: DotsDeclarationIssue, label: (kind: DotsDeclarationIssue['kinds'][number]) => string): string {
  const names = issue.kinds.map(label).join(' + ');
  if (issue.code === 'SCORE_QUALIFICATION') return `${names} cannot qualify from this golfer's entered gross score.`;
  return `${names} cannot coexist for the same golfer on this hole.`;
}
