const tones = ['sage', 'sky', 'sand', 'lavender', 'rose', 'peach', 'seafoam', 'slate'] as const;
export type RoundTone = typeof tones[number];

export function roundToneFor(roundId: string, rounds: readonly { readonly id: string }[]): RoundTone | undefined {
  const index = rounds.findIndex((round) => round.id === roundId);
  return index < 0 ? undefined : tones[index % tones.length];
}
