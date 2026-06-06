import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const imageAssets = [
  'background.png',
  'discord_icon.png',
  'facebook_icon.png',
  'instagram_icon.png',
  'socal_icon_n.png',
  'update_notes_n_.png',
  'youtube_icon.png',
  'yt_recommended_n.png',
];

test('PNG assets are kept in the assets directory', () => {
  for (const fileName of imageAssets) {
    assert.equal(existsSync(resolve(root, 'assets', fileName)), true, `${fileName} should be in assets/`);
    assert.equal(existsSync(resolve(root, fileName)), false, `${fileName} should not live at repo root`);
  }
});
