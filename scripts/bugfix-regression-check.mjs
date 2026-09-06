// Runs the real settings hydration with in-memory storage and native dependencies
// stubbed out. No device or installed npm dependencies are needed (Node 22.18+).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guardSource = stripTypeScriptTypes(read('../src/lib/profileScope.ts')).replace('export ', '');
const settingsSource = stripTypeScriptTypes(read('../src/store/settings.ts'))
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace(/^export \{[^}]*\};/gm, '')
  .replace(/^export /gm, '');
const saved = new Map();
let profile = 'first';
let interceptRead;
function boot() {
  const context = vm.createContext({
    create: (init) => {
      let state;
      const get = () => state;
      const set = (patch) => { state = { ...state, ...patch }; };
      state = init(set, get);
      return { getState: get };
    },
    getItem: async (key) => interceptRead ? interceptRead(key) : saved.get(key) ?? null,
    setItem: async (key, value) => { saved.set(key, value); },
    profileScopeId: () => profile,
    hashKey: (key) => key,
    isLanguage: (value) => value === 'en',
    LANGUAGE_NAMES: { en: 'English' },
    DEFAULT_ACCENT: '#123456',
    applyAccents() {}, applyThemePreference() {}, setPerfEnabled() {},
    isThemePreference: () => false,
    useAuthStore: { getState: () => ({ offline: false }) },
    queryClient: { invalidateQueries() {} },
  });
  vm.runInContext(`${guardSource}\n${settingsSource}\nglobalThis.store = useSettings;`, context);
  return context.store;
}

saved.set('resonus.settings.first', JSON.stringify({ batteryWarning: false }));
let store = boot();
await store.getState().hydrate();
assert.equal(store.getState().batteryWarning, false, 'migrate existing opt-out');
assert.equal(saved.get('resonus.batteryWarning'), 'false');
profile = 'second';
store = boot();
await store.getState().hydrate();
assert.equal(store.getState().batteryWarning, false, 'opt-out survives restart and profile change');
store.getState().setBatteryWarning(true);
store = boot();
await store.getState().hydrate();
assert.equal(store.getState().batteryWarning, true, 'settings can re-enable warning');
store.getState().setBatteryWarning(false);
store = boot();
await store.getState().hydrate();
assert.equal(store.getState().batteryWarning, false, 'settings opt-out survives restart');

// An old hydration finishes while the current one is still reading settings.
store = boot();
const pending = [];
interceptRead = (key) => key.startsWith('resonus.settings.')
  ? new Promise((resolve) => pending.push(resolve))
  : saved.get(key) ?? null;
const stale = store.getState().hydrate();
const current = store.getState().hydrate();
pending[0]('{}');
await stale;
assert.equal(store.getState().hydrated, false, 'stale hydration must not open startup dialog');
pending[1]('{}');
await current;
assert.equal(store.getState().hydrated, true);
assert.equal(store.getState().batteryWarning, false);
interceptRead = undefined;

// A slow storage read must not overwrite a switch changed while it was pending.
for (const stored of ['true', null]) {
  saved.set('resonus.settings.second', JSON.stringify({ batteryWarning: true }));
  store = boot();
  let finishRead;
  const reading = new Promise((resolve) => {
    interceptRead = (key) => key === 'resonus.batteryWarning'
      ? new Promise((done) => { finishRead = done; resolve(); })
      : saved.get(key) ?? null;
  });
  const hydrating = store.getState().hydrate();
  await reading;
  store.getState().setBatteryWarning(false);
  finishRead(stored);
  await hydrating;
  assert.equal(store.getState().batteryWarning, false, 'in-flight read preserves latest opt-out');
  assert.equal(saved.get('resonus.batteryWarning'), 'false', 'migration preserves latest opt-out');
  interceptRead = undefined;
}

const playerSource = read('../src/store/player.ts');
const artworkFunction = playerSource.match(/function artworkUrlFor\(song: Song\): string \| undefined \{[\s\S]*?\n\}/)[0];
const artworkContext = vm.createContext({ songCoverUrl: (song) => song.coverArt, COVER: { card: 300 } });
vm.runInContext(stripTypeScriptTypes(artworkFunction), artworkContext);
for (const uri of [undefined, 'cached-cover:https://server/art', 'content://art/1', 'data:image/png;base64,abc']) {
  assert.equal(artworkContext.artworkUrlFor({ coverArt: uri }), undefined);
}
for (const uri of ['https://server/art', 'http://server/art', 'file:///covers/art.jpg']) {
  assert.equal(artworkContext.artworkUrlFor({ coverArt: uri }), uri);
}
console.log('Passed: artwork protocols, battery preference migration/restart/profile switching, overlapping hydration.');
