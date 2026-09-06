// Checks that cache-only cover markers never reach native URL metadata.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
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
console.log('Passed: native artwork protocols.');

