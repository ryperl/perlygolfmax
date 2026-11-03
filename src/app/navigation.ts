export const navigation = [
  { id: 'events', label: 'Events' },
  { id: 'overview', label: 'Overview' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'group', label: 'The group' },
] as const;

export type Page = (typeof navigation)[number]['id'];

export function readPage(hash: string, search = ''): Page {
  if (new URLSearchParams(search).get('event-auth') === '1' && (!hash || /^#(?:code|error)=/.test(hash))) return 'events';
  const id = hash.replace(/^#/, '');
  return navigation.find((page) => page.id === id)?.id ?? 'overview';
}
