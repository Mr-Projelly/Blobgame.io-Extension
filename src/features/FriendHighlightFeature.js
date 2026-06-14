import { normalizeUid } from '../roles/RoleRegistry.js';

const FRIEND_TEXT_CLASS = 'blobio-chat-friend-text';
const FRIEND_UID_ATTR = 'data-blobio-friend-uid';
const UID_ATTRS = ['uid', 'data-uid', 'data-user-id', 'data-account-id', 'data-id'];
const UID_SELECTOR = UID_ATTRS.map((attr) => `[${attr}]`).join(',');

function uidFromElement(element) {
  for (const attr of UID_ATTRS) {
    const uid = normalizeUid(element?.getAttribute?.(attr));
    if (uid) {
      return uid;
    }
  }

  return '';
}

function isExtensionTag(element) {
  return Boolean(element?.classList?.contains?.('blobio-extension-chat-tag'));
}

export class FriendHighlightFeature {
  constructor({
    document = globalThis.document,
    friendHighlightStore,
    friendRelationService,
    roleRegistry,
  } = {}) {
    this.document = document;
    this.window = document?.defaultView || globalThis;
    this.friendHighlightStore = friendHighlightStore;
    this.friendRelationService = friendRelationService;
    this.roleRegistry = roleRegistry;
    this.observer = null;
    this.frameId = 0;
    this.unsubscribeSetting = null;
    this.unsubscribeRelations = null;
    this.unsubscribeRoles = null;
    this.debugApi = null;
    this.started = false;
  }

  start() {
    if (this.started || !this.document?.documentElement) {
      return Boolean(this.started);
    }

    this.started = true;
    this.unsubscribeSetting = this.friendHighlightStore?.subscribe?.(() => this.scheduleUpdate());
    this.unsubscribeRelations = this.friendRelationService?.subscribe?.(() => this.scheduleUpdate());
    this.unsubscribeRoles = this.roleRegistry?.subscribe?.(() => this.scheduleUpdate());
    this.installObserver();
    this.debugApi = {
      status: () => ({
        enabled: Boolean(this.friendHighlightStore?.isEnabled?.()),
        friends: this.friendRelationService?.getFriendUids?.() || [],
        tokenPresent: Boolean(this.friendRelationService?.readAccessToken?.()),
      }),
      refresh: () => this.friendRelationService?.refresh?.(true),
      apply: () => this.applyFriendStyles(),
    };
    this.window.blobioFriendHighlight = this.debugApi;
    this.scheduleUpdate();
    return true;
  }

  installObserver() {
    const MutationObserver = this.window.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)) {
          this.scheduleUpdate();
          return;
        }

        if (mutation.type === 'attributes' && UID_ATTRS.includes(mutation.attributeName)) {
          this.scheduleUpdate();
          return;
        }
      }
    });

    this.observer.observe(this.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: UID_ATTRS,
    });
  }

  scheduleUpdate() {
    if (this.frameId) {
      return;
    }

    const requestFrame = this.window.requestAnimationFrame?.bind(this.window)
      || ((callback) => this.window.setTimeout?.(callback, 0));

    this.frameId = requestFrame?.(() => {
      this.frameId = 0;
      this.applyFriendStyles();
    }) || 0;
  }

  applyFriendStyles() {
    const chat = this.document.querySelector?.('#chat');
    if (!chat) {
      return;
    }

    this.clearFriendStyles(chat);
    if (!this.friendHighlightStore?.isEnabled?.()) {
      return;
    }

    const uidNodes = [];
    if (this.hasUid(chat)) {
      uidNodes.push(chat);
    }
    for (const node of chat.querySelectorAll?.(UID_SELECTOR) || []) {
      uidNodes.push(node);
    }

    for (const node of uidNodes) {
      const uid = uidFromElement(node);
      if (!uid || !this.friendRelationService?.isFriend?.(uid)) {
        continue;
      }

      const roles = this.roleRegistry?.getRoles?.(uid);
      if (roles?.admin) {
        continue;
      }

      const spans = Array.from(node.querySelectorAll?.('span') || []);
      if (spans.length === 0) {
        this.markFriendText(node, uid);
        continue;
      }

      for (const span of spans) {
        if (!isExtensionTag(span)) {
          this.markFriendText(span, uid);
        }
      }
    }
  }

  hasUid(element) {
    return UID_ATTRS.some((attr) => element?.hasAttribute?.(attr));
  }

  markFriendText(element, uid) {
    element.classList?.add?.(FRIEND_TEXT_CLASS);
    element.setAttribute?.(FRIEND_UID_ATTR, uid);
  }

  clearFriendStyles(root = this.document) {
    const elements = [];
    if (root?.classList?.contains?.(FRIEND_TEXT_CLASS)) {
      elements.push(root);
    }
    for (const element of root?.querySelectorAll?.(`.${FRIEND_TEXT_CLASS}`) || []) {
      elements.push(element);
    }

    for (const element of elements) {
      element.classList?.remove?.(FRIEND_TEXT_CLASS);
      element.removeAttribute?.(FRIEND_UID_ATTR);
    }
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;

    if (this.frameId) {
      const cancelFrame = this.window.cancelAnimationFrame?.bind(this.window)
        || this.window.clearTimeout?.bind(this.window);
      cancelFrame?.(this.frameId);
      this.frameId = 0;
    }

    this.unsubscribeSetting?.();
    this.unsubscribeRelations?.();
    this.unsubscribeRoles?.();
    this.unsubscribeSetting = null;
    this.unsubscribeRelations = null;
    this.unsubscribeRoles = null;
    this.clearFriendStyles(this.document);
    if (this.window.blobioFriendHighlight === this.debugApi) {
      delete this.window.blobioFriendHighlight;
    }
    this.debugApi = null;
    this.started = false;
  }
}

export { FRIEND_TEXT_CLASS, FRIEND_UID_ATTR, UID_ATTRS, uidFromElement };
