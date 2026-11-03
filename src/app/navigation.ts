export const navigation = [
  { id: 'overview', label: 'Overview' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'group', label: 'The group' },
] as const;

export type Page = (typeof navigation)[number]['id'];

export function readPage(hash: string): Page {
  const id = hash.replace(/^#/, '');
  return navigation.find((page) => page.id === id)?.id ?? 'overview';
}
