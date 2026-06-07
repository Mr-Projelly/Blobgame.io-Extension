import assert from 'node:assert/strict';
import test from 'node:test';

import { getBlobioHostMode } from '../src/hostRules.js';

test('getBlobioHostMode enables full UI only on the Blobgame front page', () => {
  assert.equal(getBlobioHostMode({ hostname: 'blobgame.io' }), 'frontpage');
  assert.equal(getBlobioHostMode({ hostname: 'www.blobgame.io' }), 'frontpage');
  assert.equal(getBlobioHostMode({ hostname: 'custom.client.blobgame.io' }), 'runtime');
  assert.equal(getBlobioHostMode({ hostname: 'example.com' }), 'off');
});
