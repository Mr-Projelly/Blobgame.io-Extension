import { createBlobioStorage } from '../storage/BlobioStorage.js';
import { readInGameUiSettings } from '../settings/InGameUiSettings.js';

const CHAT_NEAR_BOTTOM_PX = 36;
const MESSAGE_ANIMATION_MS = 320;

function hexToRgba(color, alpha) {
  const value = String(color || '#000000').replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16) || 0;
  const green = Number.parseInt(value.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
}

function setCssVariable(element, name, value) {
  if (typeof element?.style?.setProperty === 'function') {
    element.style.setProperty(name, value);
  } else if (element?.style) {
    element.style[name] = value;
  }
}

function removeCssVariable(element, name) {
  if (typeof element?.style?.removeProperty === 'function') {
    element.style.removeProperty(name);
  } else if (element?.style) {
    delete element.style[name];
  }
}

export class GameUiCustomizationFeature {
  constructor({
    document = globalThis.document,
    storage = createBlobioStorage(document),
    logger = console,
  } = {}) {
    this.document = document;
    this.storage = storage;
    this.logger = logger;
    this.pageObserver = null;
    this.chatObserver = null;
    this.chatElement = null;
    this.chatList = null;
    this.chatScrollHandler = null;
    this.nearChatBottom = true;
    this.messageTimers = new Set();
    this.stats = {
      addedMessages: 0,
      smoothScrollCalls: 0,
      lastMutationAt: 0,
    };
    this.started = false;
  }

  start() {
    if (this.started || !this.document?.documentElement) {
      return Boolean(this.started);
    }

    this.started = true;
    this.applyAll();
    this.watchPage();
    this.installDebug();
    return true;
  }

  applyAll() {
    const settings = readInGameUiSettings(this.storage);
    this.applyChatAppearance(settings);
    this.applyLeaderboardAppearance(settings);
    this.applyCaptchaLogo(settings.hideCaptchaLogo);
    this.syncSmoothChat(settings.smoothChat);
    return settings;
  }

  applyChatAppearance(settings) {
    const chat = this.document.querySelector?.('#chat');
    if (!chat) {
      return false;
    }

    chat.classList.toggle('blobio-chat-background-enabled', settings.chatBackground.enabled);
    chat.classList.toggle('blobio-chat-outline-enabled', settings.chatOutline.enabled);

    if (settings.chatBackground.enabled) {
      setCssVariable(chat, '--blobio-chat-background', hexToRgba(
        settings.chatBackground.color,
        settings.chatBackground.alpha,
      ));
    } else {
      removeCssVariable(chat, '--blobio-chat-background');
    }

    if (settings.chatOutline.enabled) {
      setCssVariable(chat, '--blobio-chat-outline', hexToRgba(
        settings.chatOutline.color,
        settings.chatOutline.alpha,
      ));
    } else {
      removeCssVariable(chat, '--blobio-chat-outline');
    }

    return true;
  }

  applyLeaderboardAppearance(settings) {
    const wrapper = this.document.querySelector?.('#leader-board-wrapper');
    if (!wrapper) {
      return false;
    }

    wrapper.classList.toggle(
      'blobio-leaderboard-background-enabled',
      settings.leaderboardBackground.enabled,
    );
    wrapper.classList.toggle(
      'blobio-leaderboard-outline-enabled',
      settings.leaderboardOutline.enabled,
    );
    wrapper.classList.toggle(
      'blobio-leaderboard-font-size-enabled',
      settings.leaderboardFont.enabled,
    );

    if (settings.leaderboardBackground.enabled) {
      setCssVariable(wrapper, '--blobio-leaderboard-background', hexToRgba(
        settings.leaderboardBackground.color,
        settings.leaderboardBackground.alpha,
      ));
    } else {
      removeCssVariable(wrapper, '--blobio-leaderboard-background');
    }

    if (settings.leaderboardOutline.enabled) {
      setCssVariable(wrapper, '--blobio-leaderboard-outline', hexToRgba(
        settings.leaderboardOutline.color,
        settings.leaderboardOutline.alpha,
      ));
    } else {
      removeCssVariable(wrapper, '--blobio-leaderboard-outline');
    }

    setCssVariable(wrapper, '--blobio-leaderboard-font-size', `${settings.leaderboardFont.value}px`);
    return true;
  }

  applyCaptchaLogo(hidden) {
    const applyInDocument = (documentRef) => {
      let changed = false;
      for (const logo of documentRef?.querySelectorAll?.('.rc-anchor-logo-img, .rc-anchor-logo-img-large') || []) {
        logo.classList.toggle('blobio-captcha-logo-hidden', Boolean(hidden));
        changed = true;
      }
      return changed;
    };

    let changed = applyInDocument(this.document);
    for (const frame of this.document.querySelectorAll?.('iframe[src*="recaptcha"]') || []) {
      try {
        changed = applyInDocument(frame.contentDocument) || changed;
      } catch {
        // Cross-origin reCAPTCHA frames are handled by the loader's frame-only branch.
      }
    }
    return changed;
  }

  syncSmoothChat(enabled) {
    const chat = this.document.querySelector?.('#chat') || null;
    const list = chat?.querySelector?.('ul') || null;

    if (!enabled || !chat || !list) {
      this.disconnectSmoothChat();
      chat?.classList?.remove('blobio-smooth-chat');
      return false;
    }

    chat.classList.add('blobio-smooth-chat');
    if (chat === this.chatElement && list === this.chatList && this.chatObserver) {
      return true;
    }

    this.disconnectSmoothChat();
    this.chatElement = chat;
    this.chatList = list;
    this.nearChatBottom = this.isNearChatBottom();
    this.chatScrollHandler = () => {
      this.nearChatBottom = this.isNearChatBottom();
    };
    chat.addEventListener?.('scroll', this.chatScrollHandler, { passive: true });

    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return true;
    }

    this.chatObserver = new MutationObserver((mutations) => this.handleChatMutations(mutations));
    this.chatObserver.observe(list, { childList: true });
    return true;
  }

  handleChatMutations(mutations) {
    let addedCount = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node?.nodeType !== 1 || String(node.tagName || '').toLowerCase() !== 'li') {
          continue;
        }
        addedCount += 1;
        this.animateMessage(node);
      }
    }

    if (addedCount === 0) {
      return;
    }

    this.stats.addedMessages += addedCount;
    this.stats.lastMutationAt = Date.now();
    if (this.nearChatBottom) {
      this.scrollChatToBottom();
    }
  }

  animateMessage(message) {
    message.classList?.add('blobio-chat-message-enter');
    const win = this.document.defaultView || globalThis;
    const timer = win.setTimeout?.(() => {
      this.messageTimers.delete(timer);
      message.classList?.remove('blobio-chat-message-enter');
    }, MESSAGE_ANIMATION_MS);
    if (timer !== undefined && timer !== null) {
      this.messageTimers.add(timer);
    }
  }

  scrollChatToBottom() {
    const chat = this.chatElement;
    if (!chat) {
      return;
    }

    this.stats.smoothScrollCalls += 1;
    const top = Math.max(0, Number(chat.scrollHeight) || 0);
    if (typeof chat.scrollTo === 'function') {
      try {
        chat.scrollTo({ top, behavior: 'smooth' });
        return;
      } catch {}
    }
    chat.scrollTop = top;
  }

  isNearChatBottom() {
    const chat = this.chatElement;
    if (!chat) {
      return true;
    }

    const remaining = (Number(chat.scrollHeight) || 0)
      - (Number(chat.scrollTop) || 0)
      - (Number(chat.clientHeight) || 0);
    return remaining <= CHAT_NEAR_BOTTOM_PX;
  }

  disconnectSmoothChat() {
    this.chatObserver?.disconnect();
    this.chatObserver = null;
    if (this.chatElement && this.chatScrollHandler) {
      this.chatElement.removeEventListener?.('scroll', this.chatScrollHandler);
    }
    this.chatElement?.classList?.remove('blobio-smooth-chat');
    this.chatElement = null;
    this.chatList = null;
    this.chatScrollHandler = null;
  }

  watchPage() {
    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node?.id === 'chat'
            || node?.id === 'leader-board-wrapper'
            || node?.matches?.('.rc-anchor-logo-img, .rc-anchor-logo-img-large')
            || node?.querySelector?.('#chat, #leader-board-wrapper, .rc-anchor-logo-img, .rc-anchor-logo-img-large')) {
            this.applyAll();
            return;
          }
        }
      }
    });
    this.pageObserver.observe(this.document.documentElement, { childList: true, subtree: true });
  }

  installDebug() {
    const win = this.document.defaultView || globalThis;
    win.__blobioSmoothChatDebug = () => ({
      enabled: readInGameUiSettings(this.storage).smoothChat,
      chatFound: Boolean(this.document.querySelector?.('#chat')),
      listFound: Boolean(this.chatList),
      observerActive: Boolean(this.chatObserver),
      nearBottom: this.nearChatBottom,
      ...this.stats,
    });
  }

  destroy() {
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.disconnectSmoothChat();

    const win = this.document.defaultView || globalThis;
    for (const timer of this.messageTimers) {
      win.clearTimeout?.(timer);
    }
    this.messageTimers.clear();

    const chat = this.document.querySelector?.('#chat');
    chat?.classList?.remove('blobio-chat-background-enabled', 'blobio-chat-outline-enabled');
    removeCssVariable(chat, '--blobio-chat-background');
    removeCssVariable(chat, '--blobio-chat-outline');

    const leaderboard = this.document.querySelector?.('#leader-board-wrapper');
    leaderboard?.classList?.remove(
      'blobio-leaderboard-background-enabled',
      'blobio-leaderboard-outline-enabled',
      'blobio-leaderboard-font-size-enabled',
    );
    removeCssVariable(leaderboard, '--blobio-leaderboard-background');
    removeCssVariable(leaderboard, '--blobio-leaderboard-outline');
    removeCssVariable(leaderboard, '--blobio-leaderboard-font-size');

    this.applyCaptchaLogo(false);
    try { delete win.__blobioSmoothChatDebug; } catch {}
    this.started = false;
  }
}
