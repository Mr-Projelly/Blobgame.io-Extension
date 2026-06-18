export const JELLY_SHADER_KEYS = {
  enabled: 'blobio.settings.jellyShader.enabled',
  skinCells: 'blobio.settings.jellyShader.skinCells',
  noSkinCells: 'blobio.settings.jellyShader.noSkinCells',
};

export const DEFAULT_JELLY_SHADER_SETTINGS = Object.freeze({
  enabled: false,
  skinCells: true,
  noSkinCells: false,
});

function readBoolean(storage, key, fallback) {
  try {
    const value = storage?.getItem?.(key);
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    return value === '1' || String(value).toLowerCase() === 'true';
  } catch {
    return fallback;
  }
}

export function normalizeJellyShaderSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    enabled: source.enabled === undefined ? DEFAULT_JELLY_SHADER_SETTINGS.enabled : Boolean(source.enabled),
    skinCells: source.skinCells === undefined ? DEFAULT_JELLY_SHADER_SETTINGS.skinCells : Boolean(source.skinCells),
    noSkinCells: source.noSkinCells === undefined ? DEFAULT_JELLY_SHADER_SETTINGS.noSkinCells : Boolean(source.noSkinCells),
  };
}

export function readJellyShaderSettings(storage) {
  return normalizeJellyShaderSettings({
    enabled: readBoolean(storage, JELLY_SHADER_KEYS.enabled, DEFAULT_JELLY_SHADER_SETTINGS.enabled),
    skinCells: readBoolean(storage, JELLY_SHADER_KEYS.skinCells, DEFAULT_JELLY_SHADER_SETTINGS.skinCells),
    noSkinCells: readBoolean(storage, JELLY_SHADER_KEYS.noSkinCells, DEFAULT_JELLY_SHADER_SETTINGS.noSkinCells),
  });
}

export function saveJellyShaderSettings(storage, settings) {
  const next = normalizeJellyShaderSettings(settings);
  try {
    storage?.setItem?.(JELLY_SHADER_KEYS.enabled, next.enabled ? '1' : '0');
    storage?.setItem?.(JELLY_SHADER_KEYS.skinCells, next.skinCells ? '1' : '0');
    storage?.setItem?.(JELLY_SHADER_KEYS.noSkinCells, next.noSkinCells ? '1' : '0');
  } catch {}
  return next;
}
