import type { SavedScoreLocation } from '../domain/score-location';

const storageKey = 'perly-golf-max:last-score-location:v1';
const maximumLength = 1024;
const fields = ['version', 'eventId', 'roundId', 'groupNumber', 'holeNumber', 'view'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageWarning = 'Your scoring place could not be stored on this device. You can keep scoring on this page; reopening may not restore your place.';
const restoreWarning = 'Your previous scoring place could not be restored. Choose an event, round, group and hole to continue.';

export function isSavedScoreLocation(value: unknown): value is SavedScoreLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !keys.every((key) => fields.includes(key))) return false;
  return 'version' in value && value.version === 1
    && 'eventId' in value && typeof value.eventId === 'string' && uuid.test(value.eventId)
    && 'roundId' in value && typeof value.roundId === 'string' && uuid.test(value.roundId)
    && 'groupNumber' in value && typeof value.groupNumber === 'number' && Number.isSafeInteger(value.groupNumber) && value.groupNumber > 0
    && 'holeNumber' in value && typeof value.holeNumber === 'number' && Number.isSafeInteger(value.holeNumber) && value.holeNumber >= 1 && value.holeNumber <= 18
    && 'view' in value && (value.view === 'entry' || value.view === 'cards' || value.view === 'games' || value.view === 'leaderboard');
}

export function loadScoreLocation(storage?: Storage): { readonly location: SavedScoreLocation | null; readonly error?: string } {
  try {
    const text = (storage ?? window.localStorage).getItem(storageKey);
    if (text === null) return { location: null };
    if (text.length > maximumLength) return { location: null, error: restoreWarning };
    const value: unknown = JSON.parse(text);
    return isSavedScoreLocation(value) ? { location: value } : { location: null, error: restoreWarning };
  } catch {
    return { location: null, error: restoreWarning };
  }
}

export function saveScoreLocation(location: SavedScoreLocation, storage?: Storage): string | null {
  if (!isSavedScoreLocation(location)) return storageWarning;
  try {
    const { version, eventId, roundId, groupNumber, holeNumber, view } = location;
    (storage ?? window.localStorage).setItem(storageKey, JSON.stringify({ version, eventId, roundId, groupNumber, holeNumber, view }));
    return null;
  } catch {
    return storageWarning;
  }
}

export function clearScoreLocation(storage?: Storage): string | null {
  try {
    (storage ?? window.localStorage).removeItem(storageKey);
    return null;
  } catch {
    return 'Your previous scoring place could not be cleared on this device. Reopening may restore the old place.';
  }
}

export function scoreLocationHref(location: SavedScoreLocation): string {
  if (!isSavedScoreLocation(location)) throw new Error('Invalid scoring location.');
  const query = new URLSearchParams({
    event: location.eventId, round: location.roundId, group: String(location.groupNumber),
    hole: String(location.holeNumber), view: location.view,
  });
  return `#events?${query.toString()}`;
}

export function readScoreLocation(hash: string): SavedScoreLocation | null {
  if (hash.length > maximumLength || !hash.startsWith('#events?')) return null;
  const query = new URLSearchParams(hash.slice('#events?'.length));
  const names = ['event', 'round', 'group', 'hole', 'view'];
  if ([...query.keys()].length !== names.length || !names.every((name) => query.getAll(name).length === 1)) return null;
  const group = query.get('group') ?? '';
  const hole = query.get('hole') ?? '';
  if (!/^[1-9]\d*$/.test(group) || !/^[1-9]\d*$/.test(hole)) return null;
  const value = {
    version: 1, eventId: query.get('event'), roundId: query.get('round'),
    groupNumber: Number(group), holeNumber: Number(hole), view: query.get('view'),
  };
  return isSavedScoreLocation(value) ? value : null;
}
