export const VIRUS_MOTHER_CELL_KEYS = {
  enabled: 'blobio.settings.virusMotherCell.enabled',
  maskId: 'blobio.settings.virusMotherCell.maskId',
  color: 'blobio.settings.virusMotherCell.color',
  alpha: 'blobio.settings.virusMotherCell.alpha',
  rotate: 'blobio.settings.virusMotherCell.rotate',
};

export const VIRUS_MOTHER_CELL_MASKS = ['halo', 'rotate', 'ring'];

export const DEFAULT_VIRUS_MOTHER_CELL_SETTINGS = Object.freeze({
  enabled: false,
  maskId: 'halo',
  color: '#ff0000',
  alpha: 0.85,
  rotate: false,
});

export function readVirusMotherCellSettings(storage) {
  return {
    enabled: readBoolean(storage, VIRUS_MOTHER_CELL_KEYS.enabled, DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.enabled),
    maskId: normalizeVirusMaskId(storage?.getItem?.(VIRUS_MOTHER_CELL_KEYS.maskId)),
    color: normalizeVirusColor(storage?.getItem?.(VIRUS_MOTHER_CELL_KEYS.color)),
    alpha: normalizeVirusAlpha(storage?.getItem?.(VIRUS_MOTHER_CELL_KEYS.alpha)),
    rotate: readBoolean(storage, VIRUS_MOTHER_CELL_KEYS.rotate, DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.rotate),
  };
}

export function saveVirusMotherCellSettings(storage, settings) {
  const clean = {
    enabled: Boolean(settings?.enabled),
    maskId: normalizeVirusMaskId(settings?.maskId),
    color: normalizeVirusColor(settings?.color),
    alpha: normalizeVirusAlpha(settings?.alpha),
    rotate: Boolean(settings?.rotate),
  };

  storage?.setItem?.(VIRUS_MOTHER_CELL_KEYS.enabled, clean.enabled ? '1' : '0');
  storage?.setItem?.(VIRUS_MOTHER_CELL_KEYS.maskId, clean.maskId);
  storage?.setItem?.(VIRUS_MOTHER_CELL_KEYS.color, clean.color);
  storage?.setItem?.(VIRUS_MOTHER_CELL_KEYS.alpha, String(clean.alpha));
  storage?.setItem?.(VIRUS_MOTHER_CELL_KEYS.rotate, clean.rotate ? '1' : '0');
  return clean;
}

export function normalizeVirusMaskId(value) {
  const maskId = String(value || '').trim().toLowerCase();
  return VIRUS_MOTHER_CELL_MASKS.includes(maskId)
    ? maskId
    : DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.maskId;
}

export function normalizeVirusColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color)
    ? color
    : DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.color;
}

export function normalizeVirusAlpha(value) {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.alpha;
  }
  const alpha = Number(value);
  if (!Number.isFinite(alpha)) {
    return DEFAULT_VIRUS_MOTHER_CELL_SETTINGS.alpha;
  }
  return Math.max(0, Math.min(1, Math.round(alpha * 100) / 100));
}

function readBoolean(storage, key, fallback) {
  const value = storage?.getItem?.(key);
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return value === '1' || value === 'true';
}
