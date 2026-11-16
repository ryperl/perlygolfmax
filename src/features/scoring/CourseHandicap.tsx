import type { PlayerCourseHandicap } from '../../domain/scoring';

export function CourseHandicap({ value, className, compact = false }: {
  readonly value: PlayerCourseHandicap | undefined;
  readonly className: string;
  readonly compact?: boolean;
}) {
  const handicap = value?.courseHandicap;
  const text = typeof handicap === 'number'
    ? `CH ${handicap < 0 ? `+${String(Math.abs(handicap))}` : String(handicap)}`
    : value?.unavailableReason === 'missing-handicap-index' ? 'NH' : 'CH —';
  return <span className={className}
    title={typeof handicap === 'number' ? 'Course handicap for this round and tee, before game allowance' : 'Course handicap unavailable'}
    aria-label={typeof handicap === 'number' ? `Course handicap: ${text.slice(3)}`
      : text === 'NH' ? 'No captured Handicap Index' : 'Course handicap unavailable'}>{compact && text.startsWith('CH ') ? text.slice(3) : text}</span>;
}
