import { createLocalDotPresetStore } from '../client/dot-presets';

export const browserDotPresets = createLocalDotPresetStore({
  getItem(key) { return window.localStorage.getItem(key); },
  setItem(key, value) { window.localStorage.setItem(key, value); },
});
