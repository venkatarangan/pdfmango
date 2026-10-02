// The visitor's settings, kept in this browser's localStorage. Only settings are ever stored (never
// anything about files), and only once the visitor changes something; Reset removes the entry.
import { DEFAULTS, diff, merge, sanitizeOverrides, type Settings } from './settings';

const KEY = 'pdfmango.settings.v1';

function load(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {}; // storage blocked, private mode, or unreadable JSON: use the defaults
  }
}

class SettingsStore {
  current = $state.raw<Settings>(merge(load()));
  customized = $derived(Object.keys(diff(this.current)).length > 0);

  update(patch: Partial<Settings>) {
    this.current = merge(sanitizeOverrides({ ...diff(this.current), ...patch }));
    this.save();
  }

  reset() {
    this.current = merge({});
    this.save();
  }

  private save() {
    try {
      const overrides = diff(this.current);
      if (Object.keys(overrides).length === 0) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(overrides));
    } catch {
      // Not saved (storage unavailable); the change still applies for this visit.
    }
  }
}

export const settings = new SettingsStore();
export { DEFAULTS };
