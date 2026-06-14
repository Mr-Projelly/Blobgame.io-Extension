import { createBlobioStorage } from '../storage/BlobioStorage.js';

export const HOTKEYS_STORAGE_KEY = 'blobio.chat.hotkeys';
export const HOTKEY_TEXT_LIMIT = 50;

const MOUSE_BUTTONS = new Set([0, 1, 2]);

function normalizeText(value) {
  return String(value ?? '').trim().slice(0, HOTKEY_TEXT_LIMIT);
}

function normalizeKeyCode(value) {
  const code = String(value ?? '').trim();
  return code && code.length <= 64 && !/\s/.test(code) ? code : '';
}

function normalizeMouseButton(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const button = Number(value);
  return MOUSE_BUTTONS.has(button) ? button : null;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = String(value.id ?? '').trim();
  const text = normalizeText(value.text);
  if (!id || !text) {
    return null;
  }

  return {
    id,
    text,
    keyCode: normalizeKeyCode(value.keyCode),
    mouseButton: normalizeMouseButton(value.mouseButton),
  };
}

function cloneEntry(entry) {
  return { ...entry };
}

export class HotkeyStore {
  constructor({
    document = globalThis.document,
    storage = createBlobioStorage(document),
    logger = console,
  } = {}) {
    this.document = document;
    this.storage = storage;
    this.logger = logger;
    this.entries = [];
    this.listeners = new Set();
    this.nextId = 1;
    this.started = false;
  }

  start() {
    if (this.started) {
      return true;
    }

    this.entries = this.readEntries();
    this.started = true;
    return true;
  }

  getHotkeys() {
    return this.entries.map(cloneEntry);
  }

  getById(id) {
    const entry = this.entries.find((item) => item.id === String(id));
    return entry ? cloneEntry(entry) : null;
  }

  findByKey(code) {
    const normalized = normalizeKeyCode(code);
    const entry = normalized && this.entries.find((item) => item.keyCode === normalized);
    return entry ? cloneEntry(entry) : null;
  }

  findByMouse(button) {
    const normalized = normalizeMouseButton(button);
    const entry = normalized !== null && this.entries.find((item) => item.mouseButton === normalized);
    return entry ? cloneEntry(entry) : null;
  }

  add(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return null;
    }

    const entry = {
      id: this.createId(),
      text: normalized,
      keyCode: '',
      mouseButton: null,
    };
    this.entries.push(entry);
    this.commit();
    return cloneEntry(entry);
  }

  remove(id) {
    const targetId = String(id ?? '');
    const next = this.entries.filter((entry) => entry.id !== targetId);
    if (next.length === this.entries.length) {
      return false;
    }

    this.entries = next;
    this.commit();
    return true;
  }

  setKey(id, code) {
    const targetId = String(id ?? '');
    const normalized = normalizeKeyCode(code);
    const target = this.entries.find((entry) => entry.id === targetId);
    if (!target) {
      return false;
    }

    let changed = target.keyCode !== normalized;
    for (const entry of this.entries) {
      if (entry.id !== targetId && normalized && entry.keyCode === normalized) {
        entry.keyCode = '';
        changed = true;
      }
    }
    target.keyCode = normalized;

    if (changed) {
      this.commit();
    }
    return true;
  }

  setMouse(id, button) {
    const targetId = String(id ?? '');
    const normalized = normalizeMouseButton(button);
    const target = this.entries.find((entry) => entry.id === targetId);
    if (!target) {
      return false;
    }

    let changed = target.mouseButton !== normalized;
    for (const entry of this.entries) {
      if (entry.id !== targetId && normalized !== null && entry.mouseButton === normalized) {
        entry.mouseButton = null;
        changed = true;
      }
    }
    target.mouseButton = normalized;

    if (changed) {
      this.commit();
    }
    return true;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readEntries() {
    try {
      const parsed = JSON.parse(this.storage?.getItem?.(HOTKEYS_STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) {
        return [];
      }

      const ids = new Set();
      const keyCodes = new Set();
      const mouseButtons = new Set();
      const entries = [];

      for (const value of parsed) {
        const entry = normalizeEntry(value);
        if (!entry || ids.has(entry.id)) {
          continue;
        }

        ids.add(entry.id);
        if (entry.keyCode && keyCodes.has(entry.keyCode)) {
          entry.keyCode = '';
        }
        if (entry.keyCode) {
          keyCodes.add(entry.keyCode);
        }

        if (entry.mouseButton !== null && mouseButtons.has(entry.mouseButton)) {
          entry.mouseButton = null;
        }
        if (entry.mouseButton !== null) {
          mouseButtons.add(entry.mouseButton);
        }
        entries.push(entry);
      }

      return entries;
    } catch (error) {
      this.logger?.warn?.('[Blobio] Hotkey settings could not be read.', error);
      return [];
    }
  }

  createId() {
    const win = this.document?.defaultView || globalThis;
    if (typeof win.crypto?.randomUUID === 'function') {
      return win.crypto.randomUUID();
    }

    const id = `hk-${Date.now().toString(36)}-${this.nextId.toString(36)}`;
    this.nextId += 1;
    return id;
  }

  commit() {
    try {
      this.storage?.setItem?.(HOTKEYS_STORAGE_KEY, JSON.stringify(this.entries));
    } catch (error) {
      this.logger?.warn?.('[Blobio] Hotkey settings could not be saved.', error);
    }

    const snapshot = this.getHotkeys();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger?.warn?.('[Blobio] Hotkey listener failed.', error);
      }
    }
  }

  destroy() {
    this.listeners.clear();
    this.started = false;
  }
}
