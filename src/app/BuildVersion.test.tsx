import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BuildVersion } from './BuildVersion';

describe('footer build identity', () => {
  it('shows the public version and unique build without brackets, with an accessible build timestamp', () => {
    const metadata = { version: '0.1.0', sha: '1a1f7fff9828358c21f3cfee5421b5950a0e303c',
      builtAt: '2026-11-21T18:00:00Z', modified: false };
    render(<BuildVersion metadata={metadata} />);
    const label = screen.getByLabelText('App version 0.1.0, build 1a1f7fff, built 2026-11-21T18:00:00Z');
    expect(label).toHaveTextContent('v0.1.0 · 1a1f7fff');
    expect(label).not.toHaveTextContent(/[[\]]/);
    expect(label).toHaveAttribute('title', `Build ${metadata.sha} · Built ${metadata.builtAt}`);
  });
  it('does not present modified worktree assets as the released commit', () => {
    render(<BuildVersion metadata={{ version: '0.1.0', sha: 'a'.repeat(40), builtAt: '2026-11-21T18:00:00Z', modified: true }} />);
    expect(screen.getByText('v0.1.0 · aaaaaaaa-local')).toHaveAttribute('title', expect.stringContaining('Local changes'));
  });
});
