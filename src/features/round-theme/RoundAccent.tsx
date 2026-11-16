import type { ReactNode } from 'react';
import type { RoundTone } from './round-theme';
import './round-theme.css';

export function RoundAccent({ tone, className = '', children }: {
  readonly tone?: RoundTone | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={`round-accent ${className}`.trim()} data-round-tone={tone}>{children}</div>;
}
