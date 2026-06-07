export function getBlobioHostMode(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname || '').toLowerCase();

  if (hostname === 'custom.client.blobgame.io') {
    return 'runtime';
  }

  if (hostname === 'blobgame.io' || hostname === 'www.blobgame.io' || !hostname) {
    return 'frontpage';
  }

  return 'off';
}
