const DEFAULT_COOLDOWN_MS = 3000;
const GAMEPLAY_SELECTORS = [
  'canvas',
  '#canvas',
  '#game-canvas',
  '#game-area',
  '#game-container',
  '.game-canvas',
  '.game-container',
];
const BLOCKED_POINTER_SELECTORS = [
  '.blobio-chat-settings-root',
  '#chat',
  '#chat-wrapper',
  '#leader-board',
  '#leaderboard',
  '.leader-board',
  '.leaderboard',
  '#message',
  '#mouse-menu',
  '#mouseMenu',
  '.mouse-menu',
  '.mouseMenu',
  'app-mouse-menu',
  'app-settings',
  'app-skins',
  'app-modal',
  '#modal',
  '.modal',
  '.profile-modal',
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[contenteditable="true"]',
];

function closest(element, selector) {
  if (!element || typeof element.closest !== 'function') {
    return null;
  }

  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

function isTextEntryElement(element) {
  if (!element) {
    return false;
  }

  const tagName = String(element.tagName || '').toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  return element.isContentEditable === true || element.getAttribute?.('contenteditable') === 'true';
}

export class HotkeyFeature {
  constructor({
    document = globalThis.document,
    hotkeyStore,
    logger = console,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {}) {
    this.document = document;
    this.hotkeyStore = hotkeyStore;
    this.logger = logger;
    this.cooldownMs = cooldownMs;
    this.lastTriggeredAt = 0;
    this.sending = false;
    this.started = false;
    this.keydownHandler = null;
    this.mousedownHandler = null;
  }

  start() {
    if (this.started || !this.document || !this.hotkeyStore) {
      return Boolean(this.started);
    }

    this.hotkeyStore.start?.();
    const win = this.document.defaultView || globalThis;

    this.keydownHandler = (event) => this.handleKeydown(event);
    this.mousedownHandler = (event) => this.handleMousedown(event);
    win.addEventListener?.('keydown', this.keydownHandler, true);
    win.addEventListener?.('mousedown', this.mousedownHandler, true);
    this.started = true;
    return true;
  }

  handleKeydown(event) {
    if (this.sending || event?.repeat || !this.canUseKeyboardHotkey(event)) {
      return false;
    }

    const hotkey = this.hotkeyStore.findByKey?.(event?.code);
    if (!hotkey || !this.canTrigger()) {
      return false;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    this.trigger(hotkey);
    return true;
  }

  handleMousedown(event) {
    if (this.sending || !this.canUseMouseHotkey(event)) {
      return false;
    }

    const hotkey = this.hotkeyStore.findByMouse?.(event?.button);
    if (!hotkey || !this.canTrigger()) {
      return false;
    }

    if (event.button === 1) {
      event.preventDefault?.();
    }
    this.trigger(hotkey);
    return true;
  }

  canTrigger(now = Date.now()) {
    return !this.sending && now - this.lastTriggeredAt >= this.cooldownMs;
  }

  async trigger(hotkey) {
    if (!hotkey?.text || !this.canTrigger()) {
      return false;
    }

    this.sending = true;
    try {
      const sent = await this.sendChatText(hotkey.text);
      if (sent) {
        this.lastTriggeredAt = Date.now();
      }
      return sent;
    } catch (error) {
      this.logger?.warn?.('[Blobio] Hotkey text could not be sent.', error);
      return false;
    } finally {
      this.sending = false;
    }
  }

  canUseKeyboardHotkey(event) {
    if (!this.isRuntimeReady() || this.isExtensionMenuOpen()) {
      return false;
    }

    const activeElement = this.document.activeElement;
    if (isTextEntryElement(activeElement) || isTextEntryElement(event?.target)) {
      return false;
    }

    return !this.isChatInputOpen() && !this.hasBlockingOverlay();
  }

  canUseMouseHotkey(event) {
    if (!this.isRuntimeReady() || this.isExtensionMenuOpen() || this.isChatInputOpen()) {
      return false;
    }

    const target = event?.target;
    if (!target || BLOCKED_POINTER_SELECTORS.some((selector) => closest(target, selector))) {
      return false;
    }

    const canvases = Array.from(this.document.querySelectorAll?.('canvas') || []);
    if (canvases.length > 0) {
      if (canvases.some((canvas) => canvas === target || canvas.contains?.(target))) {
        return true;
      }

      const x = Number(event?.clientX);
      const y = Number(event?.clientY);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return canvases.some((canvas) => {
          const rect = canvas.getBoundingClientRect?.();
          return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        });
      }
      return false;
    }

    if (GAMEPLAY_SELECTORS.some((selector) => closest(target, selector))) {
      return true;
    }

    return target === this.document.body || target === this.document.documentElement;
  }

  hasBlockingOverlay() {
    const selectors = ['app-settings', 'app-skins', 'app-modal', '#modal', '.modal', '.profile-modal'];
    for (const selector of selectors) {
      for (const element of this.document.querySelectorAll?.(selector) || []) {
        if (this.isElementVisible(element)) {
          return true;
        }
      }
    }
    return false;
  }

  isRuntimeReady() {
    return Boolean(this.document.getElementById?.('message') || this.document.querySelector?.('#chat'));
  }

  isExtensionMenuOpen() {
    return Boolean(this.document.querySelector?.('.blobio-chat-settings-root.is-open'));
  }

  isChatInputOpen() {
    const input = this.document.getElementById?.('message');
    if (!input) {
      return false;
    }

    if (this.document.activeElement === input || String(input.value || '').length > 0) {
      return true;
    }

    if (input.hidden || input.getAttribute?.('aria-hidden') === 'true') {
      return false;
    }

    const inlineDisplay = String(input.style?.display || '').toLowerCase();
    if (inlineDisplay === 'none') {
      return false;
    }

    const win = this.document.defaultView || globalThis;
    const display = win.getComputedStyle?.(input)?.display;
    return display ? display !== 'none' : inlineDisplay === 'block';
  }

  async sendChatText(rawText) {
    const text = String(rawText ?? '').trim().slice(0, 50);
    if (!text) {
      return false;
    }

    let input = this.document.getElementById?.('message');
    if (!input) {
      return false;
    }

    if (!this.isElementVisible(input)) {
      this.dispatchEnter(this.document.activeElement || this.document.body || this.document.documentElement);
      await this.nextFrame();
      input = this.document.getElementById?.('message');
    }

    if (!input) {
      return false;
    }

    input.focus?.();
    this.setInputValue(input, text);
    this.dispatchInput(input, text);
    this.dispatchEnter(input);
    return true;
  }

  isElementVisible(element) {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') {
      return false;
    }

    if (String(element.style?.display || '').toLowerCase() === 'none') {
      return false;
    }

    const win = this.document.defaultView || globalThis;
    const display = win.getComputedStyle?.(element)?.display;
    return display ? display !== 'none' : true;
  }

  setInputValue(input, value) {
    const win = this.document.defaultView || globalThis;
    const prototype = win.HTMLInputElement?.prototype || globalThis.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
  }

  dispatchInput(input, text) {
    const win = this.document.defaultView || globalThis;
    let event;

    try {
      event = new win.InputEvent('input', {
        bubbles: true,
        cancelable: false,
        data: text,
        inputType: 'insertText',
      });
    } catch {
      const EventCtor = win.Event || globalThis.Event;
      event = EventCtor ? new EventCtor('input', { bubbles: true }) : { type: 'input' };
    }

    input.dispatchEvent?.(event);
  }

  dispatchEnter(target) {
    if (!target?.dispatchEvent) {
      return;
    }

    for (const type of ['keydown', 'keypress', 'keyup']) {
      target.dispatchEvent(this.createKeyboardEvent(type));
    }
  }

  createKeyboardEvent(type) {
    const win = this.document.defaultView || globalThis;
    let event;

    try {
      event = new win.KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
    } catch {
      event = { type, key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
    }

    try {
      Object.defineProperties(event, {
        keyCode: { configurable: true, get: () => 13 },
        which: { configurable: true, get: () => 13 },
      });
    } catch {}
    return event;
  }

  nextFrame() {
    const win = this.document.defaultView || globalThis;
    return new Promise((resolve) => {
      if (typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => resolve());
      } else {
        win.setTimeout?.(resolve, 0) ?? resolve();
      }
    });
  }

  destroy() {
    const win = this.document.defaultView || globalThis;
    if (this.keydownHandler) {
      win.removeEventListener?.('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    if (this.mousedownHandler) {
      win.removeEventListener?.('mousedown', this.mousedownHandler, true);
      this.mousedownHandler = null;
    }
    this.started = false;
    this.sending = false;
  }
}
