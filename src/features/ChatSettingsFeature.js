import { CHAT_SETTINGS_CSS, CHAT_SETTINGS_STYLE_ID } from '../css/ChatSettingsStyles.js';
import { createBlobioStorage } from '../storage/BlobioStorage.js';
import {
  CHAT_FONT_SIZE_LIMITS,
  getChatFontSize,
  isChatFontSizeEnabled,
  setChatFontSize,
  setChatFontSizeEnabled,
} from '../settings/RuntimeSettings.js';

const CHAT_GAP = 10;
const TOGGLE_WIDTH = 30;
const MAIN_PANEL_WIDTH = 250;
const CATEGORY_PANEL_WIDTH = 280;

export class ChatSettingsFeature {
  constructor({
    document = globalThis.document,
    storage = createBlobioStorage(document),
    logger = console,
  } = {}) {
    this.document = document;
    this.storage = storage;
    this.logger = logger;
    this.styleNode = null;
    this.root = null;
    this.chatWrapper = null;
    this.pageObserver = null;
    this.resizeObserver = null;
    this.viewportHandler = null;
    this.outsidePointerHandler = null;
    this.positionFrame = null;
    this.started = false;
  }

  start() {
    if (this.started || !this.document?.documentElement) {
      return Boolean(this.started);
    }

    this.started = true;
    this.ensureStyle();
    this.ensureUi();
    this.applyChatFontSize();
    this.watchPage();
    return true;
  }

  ensureStyle() {
    const existing = this.document.getElementById?.(CHAT_SETTINGS_STYLE_ID);
    if (existing) {
      this.styleNode = existing;
      return;
    }

    const style = this.document.createElement('style');
    style.id = CHAT_SETTINGS_STYLE_ID;
    style.textContent = CHAT_SETTINGS_CSS;
    (this.document.head || this.document.documentElement).appendChild(style);
    this.styleNode = style;
  }

  ensureUi() {
    if (this.root?.parentNode) {
      this.syncChatWrapper();
      this.positionUi();
      return;
    }

    const root = this.document.createElement('div');
    root.classList.add('blobio-chat-settings-root');

    const toggle = this.document.createElement('button');
    toggle.type = 'button';
    toggle.classList.add('blobio-chat-settings-toggle');
    toggle.setAttribute('aria-label', 'Open chat settings');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '+';

    const panel = this.document.createElement('div');
    panel.classList.add('blobio-chat-settings-panel');

    const categoryButton = this.document.createElement('button');
    categoryButton.type = 'button';
    categoryButton.classList.add('blobio-chat-settings-category-button');
    categoryButton.setAttribute('aria-expanded', 'false');

    const categoryButtonText = this.document.createElement('span');
    categoryButtonText.textContent = 'Chat-Settings';
    categoryButton.appendChild(categoryButtonText);

    const category = this.document.createElement('div');
    category.classList.add('blobio-chat-settings-category');

    const enabledButton = this.document.createElement('button');
    enabledButton.type = 'button';
    enabledButton.classList.add('blobio-chat-font-toggle');

    const label = this.document.createElement('div');
    label.classList.add('blobio-chat-font-label');
    label.textContent = 'Font-Size';

    const controls = this.document.createElement('div');
    controls.classList.add('blobio-chat-font-controls');

    const range = this.document.createElement('input');
    range.type = 'range';
    range.classList.add('blobio-chat-font-range');
    range.min = String(CHAT_FONT_SIZE_LIMITS.min);
    range.max = String(CHAT_FONT_SIZE_LIMITS.max);
    range.step = '1';

    const number = this.document.createElement('input');
    number.type = 'number';
    number.classList.add('blobio-chat-font-number');
    number.min = String(CHAT_FONT_SIZE_LIMITS.min);
    number.max = String(CHAT_FONT_SIZE_LIMITS.max);
    number.step = '1';
    number.setAttribute('aria-label', 'Chat font size');

    controls.append(range, number);
    category.append(enabledButton, label, controls);
    panel.appendChild(categoryButton);
    root.append(toggle, panel, category);
    (this.document.body || this.document.documentElement).appendChild(root);

    toggle.addEventListener('click', () => {
      this.setOpen(!root.classList.contains('is-open'));
    });

    categoryButton.addEventListener('click', () => {
      const open = !category.classList.contains('is-open');
      if (open) {
        category.classList.add('is-open');
      } else {
        category.classList.remove('is-open');
      }
      categoryButton.setAttribute('aria-expanded', String(open));
      this.positionUi();
    });

    enabledButton.addEventListener('click', () => {
      setChatFontSizeEnabled(this.storage, !isChatFontSizeEnabled(this.storage));
      this.syncControls();
      this.applyChatFontSize();
    });

    const updateSize = (value) => {
      const size = setChatFontSize(this.storage, value);
      range.value = String(size);
      number.value = String(size);
      this.applyChatFontSize();
    };

    range.addEventListener('input', () => updateSize(range.value));
    number.addEventListener('input', () => updateSize(number.value));
    number.addEventListener('change', () => updateSize(number.value));

    this.root = root;
    this.syncControls();
    this.syncChatWrapper();
    this.positionUi();

    const win = this.document.defaultView || globalThis;
    this.viewportHandler = () => this.schedulePositionUi();
    win.addEventListener?.('resize', this.viewportHandler);
    win.addEventListener?.('scroll', this.viewportHandler, true);

    this.outsidePointerHandler = (event) => {
      if (!this.root?.classList.contains('is-open')) {
        return;
      }

      const path = event.composedPath?.();
      const inside = Array.isArray(path)
        ? path.includes(this.root)
        : this.root.contains?.(event.target);

      if (!inside) {
        this.setOpen(false);
      }
    };
    this.document.addEventListener?.('pointerdown', this.outsidePointerHandler, true);
  }

  setOpen(open) {
    if (!this.root) {
      return;
    }

    const toggle = this.root.querySelector?.('.blobio-chat-settings-toggle');
    const category = this.root.querySelector?.('.blobio-chat-settings-category');
    const categoryButton = this.root.querySelector?.('.blobio-chat-settings-category-button');

    if (open) {
      this.root.classList.add('is-open');
    } else {
      this.root.classList.remove('is-open');
      category?.classList.remove('is-open');
      categoryButton?.setAttribute('aria-expanded', 'false');
    }

    if (toggle) {
      toggle.textContent = open ? '-' : '+';
      toggle.setAttribute('aria-label', open ? 'Close chat settings' : 'Open chat settings');
      toggle.setAttribute('aria-expanded', String(open));
    }

    this.positionUi();
  }

  syncControls() {
    if (!this.root) {
      return;
    }

    const enabled = isChatFontSizeEnabled(this.storage);
    const size = getChatFontSize(this.storage);
    const toggle = this.root.querySelector?.('.blobio-chat-font-toggle');
    const categoryButton = this.root.querySelector?.('.blobio-chat-settings-category-button');
    const range = this.root.querySelector?.('.blobio-chat-font-range');
    const number = this.root.querySelector?.('.blobio-chat-font-number');

    if (toggle) {
      toggle.textContent = enabled ? 'true' : 'false';
      if (enabled) {
        toggle.classList.add('is-enabled');
      } else {
        toggle.classList.remove('is-enabled');
      }
    }

    if (categoryButton) {
      if (enabled) {
        categoryButton.classList.add('has-active-setting');
      } else {
        categoryButton.classList.remove('has-active-setting');
      }
    }

    if (range) {
      range.value = String(size);
      range.disabled = !enabled;
    }
    if (number) {
      number.value = String(size);
      number.disabled = !enabled;
    }
  }

  applyChatFontSize() {
    const chat = this.document.querySelector?.('#chat');
    if (!chat) {
      return;
    }

    const enabled = isChatFontSizeEnabled(this.storage);
    const size = getChatFontSize(this.storage);
    if (enabled) {
      chat.classList.add('blobio-chat-font-size-enabled');
    } else {
      chat.classList.remove('blobio-chat-font-size-enabled');
    }
    if (typeof chat.style?.setProperty === 'function') {
      chat.style.setProperty('--blobio-chat-font-size', `${size}px`);
    } else if (chat.style) {
      chat.style['--blobio-chat-font-size'] = `${size}px`;
    }
  }

  syncChatWrapper() {
    const wrapper = this.document.querySelector?.('#chat-wrapper') || null;
    if (wrapper === this.chatWrapper) {
      return wrapper;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chatWrapper = wrapper;

    const ResizeObserver = this.document.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    if (wrapper && ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.schedulePositionUi());
      this.resizeObserver.observe(wrapper);
    }

    return wrapper;
  }

  positionUi() {
    if (!this.root) {
      return;
    }

    const wrapper = this.syncChatWrapper();
    const rect = wrapper?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.right)) {
      return;
    }

    const rootOpen = this.root.classList.contains('is-open');
    const categoryOpen = this.root.querySelector?.('.blobio-chat-settings-category')?.classList.contains('is-open');
    let totalWidth = TOGGLE_WIDTH;

    if (rootOpen) {
      totalWidth += CHAT_GAP + MAIN_PANEL_WIDTH;
      if (categoryOpen) {
        totalWidth += CHAT_GAP + CATEGORY_PANEL_WIDTH;
      }
    }

    const viewportWidth = this.document.defaultView?.innerWidth || 0;
    const preferredLeft = rect.right + CHAT_GAP;
    const left = viewportWidth > 0 && preferredLeft + totalWidth > viewportWidth - 4
      ? Math.max(4, rect.left - totalWidth - CHAT_GAP)
      : preferredLeft;

    this.setStyle('--blobio-chat-settings-left', `${Math.round(left)}px`);
    this.setStyle('--blobio-chat-settings-top', `${Math.max(4, Math.round(rect.top))}px`);
    this.setStyle('--blobio-chat-settings-bottom', 'auto');
  }

  schedulePositionUi() {
    if (this.positionFrame !== null) {
      return;
    }

    const win = this.document.defaultView || globalThis;
    if (typeof win.requestAnimationFrame !== 'function') {
      this.positionUi();
      return;
    }

    this.positionFrame = win.requestAnimationFrame(() => {
      this.positionFrame = null;
      this.positionUi();
    });
  }

  setStyle(name, value) {
    if (typeof this.root?.style?.setProperty === 'function') {
      this.root.style.setProperty(name, value);
    } else if (this.root?.style) {
      this.root.style[name] = value;
    }
  }

  watchPage() {
    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node === this.root || this.root?.contains?.(node)) {
            continue;
          }

          if (node?.id === 'chat' || node?.id === 'chat-wrapper' || node?.querySelector?.('#chat, #chat-wrapper')) {
            this.applyChatFontSize();
            this.syncChatWrapper();
            this.schedulePositionUi();
            return;
          }
        }
      }
    });

    this.pageObserver.observe(this.document.documentElement, { childList: true, subtree: true });
  }

  destroy() {
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chatWrapper = null;

    const win = this.document.defaultView || globalThis;
    if (this.viewportHandler) {
      win.removeEventListener?.('resize', this.viewportHandler);
      win.removeEventListener?.('scroll', this.viewportHandler, true);
      this.viewportHandler = null;
    }

    if (this.outsidePointerHandler) {
      this.document.removeEventListener?.('pointerdown', this.outsidePointerHandler, true);
      this.outsidePointerHandler = null;
    }

    if (this.positionFrame !== null) {
      win.cancelAnimationFrame?.(this.positionFrame);
      this.positionFrame = null;
    }

    this.document.querySelector?.('#chat')?.classList?.remove('blobio-chat-font-size-enabled');
    this.root?.remove();
    this.root = null;
    this.styleNode?.remove();
    this.styleNode = null;
    this.started = false;
  }
}
