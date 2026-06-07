import assert from 'node:assert/strict';
import test from 'node:test';

import { createBlobioStorage } from '../src/storage/BlobioStorage.js';

function createLocalStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('createBlobioStorage mirrors custom skin keys through GM storage', () => {
  const gmValues = new Map();
  const localStorage = createLocalStorage();
  const document = {
    defaultView: {
      localStorage,
      GM_getValue(key, fallback) {
        return gmValues.has(key) ? gmValues.get(key) : fallback;
      },
      GM_setValue(key, value) {
        gmValues.set(key, String(value));
      },
      GM_deleteValue(key) {
        gmValues.delete(key);
      },
    },
  };

  const storage = createBlobioStorage(document);

  storage.setItem('blobio.customSkin.activeUrl', 'https://i.imgur.com/OZz80VZ.jpeg');
  assert.equal(gmValues.get('blobio.customSkin.activeUrl'), 'https://i.imgur.com/OZz80VZ.jpeg');
  assert.equal(localStorage.getItem('blobio.customSkin.activeUrl'), 'https://i.imgur.com/OZz80VZ.jpeg');

  gmValues.set('blobio.customSkin.activeUrl', 'https://i.imgur.com/fleA2a7.png');

  assert.equal(storage.getItem('blobio.customSkin.activeUrl'), 'https://i.imgur.com/fleA2a7.png');
  assert.equal(localStorage.getItem('blobio.customSkin.activeUrl'), 'https://i.imgur.com/fleA2a7.png');

  storage.removeItem('blobio.customSkin.activeUrl');

  assert.equal(gmValues.has('blobio.customSkin.activeUrl'), false);
  assert.equal(localStorage.getItem('blobio.customSkin.activeUrl'), null);
});

test('createBlobioStorage falls back to localStorage when GM storage is unavailable', () => {
  const localStorage = createLocalStorage({ 'blobio.customSkin.enabled': '1' });
  const document = { defaultView: { localStorage } };
  const storage = createBlobioStorage(document);

  assert.equal(storage.getItem('blobio.customSkin.enabled'), '1');

  storage.setItem('blobio.customSkin.enabled', '0');

  assert.equal(localStorage.getItem('blobio.customSkin.enabled'), '0');
});
