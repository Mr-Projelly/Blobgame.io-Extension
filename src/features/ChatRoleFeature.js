import { CHAT_ROLE_CSS, CHAT_ROLE_STYLE_ID } from '../css/RoleFeatureStyles.js';
import { normalizeUid } from '../roles/RoleRegistry.js';

const EXTENSION_TAG_CLASS = 'blobio-extension-chat-tag';

export class ChatRoleFeature {
  constructor({
    document = globalThis.document,
    roleRegistry,
    logger = console,
  } = {}) {
    this.document = document;
    this.roleRegistry = roleRegistry;
    this.logger = logger;
    this.styleNode = null;
    this.pageObserver = null;
    this.chatObserver = null;
    this.chatList = null;
    this.unsubscribeRoles = null;
    this.started = false;
  }

  start() {
    if (this.started || !this.document?.documentElement) {
      return Boolean(this.started);
    }

    this.started = true;
    this.ensureStyle();
    this.unsubscribeRoles = this.roleRegistry?.subscribe?.(() => this.reprocessExistingMessages());
    this.attachChatObserver();
    this.observeForChat();
    return true;
  }

  ensureStyle() {
    const existing = this.document.getElementById?.(CHAT_ROLE_STYLE_ID);
    if (existing) {
      this.styleNode = existing;
      return;
    }

    const style = this.document.createElement('style');
    style.id = CHAT_ROLE_STYLE_ID;
    style.textContent = CHAT_ROLE_CSS;
    (this.document.head || this.document.documentElement).appendChild(style);
    this.styleNode = style;
  }

  findChatList() {
    return this.document.querySelector?.('#chat > ul') || this.document.querySelector?.('#chat ul');
  }

  attachChatObserver() {
    const chatList = this.findChatList();
    if (!chatList || chatList === this.chatList) {
      return;
    }

    this.chatObserver?.disconnect();
    this.chatList = chatList;
    this.processMessages(chatList.querySelectorAll?.('li') || [], true);

    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.chatObserver = new MutationObserver((mutations) => {
      const messages = new Set();

      for (const mutation of mutations) {
        if (String(mutation.target?.tagName || '').toUpperCase() === 'LI') {
          messages.add(mutation.target);
        }

        for (const node of mutation.addedNodes || []) {
          if (String(node?.tagName || '').toUpperCase() === 'LI') {
            messages.add(node);
          }

          for (const message of node?.querySelectorAll?.('li') || []) {
            messages.add(message);
          }
        }
      }

      this.processMessages(messages);
    });
    this.chatObserver.observe(chatList, { childList: true, subtree: true });
  }

  observeForChat() {
    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.pageObserver = new MutationObserver((mutations) => {
      if (this.chatList && this.isConnected(this.chatList)) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (this.nodeContainsChat(node)) {
            this.attachChatObserver();
            return;
          }
        }
      }
    });
    this.pageObserver.observe(this.document.documentElement, { childList: true, subtree: true });
  }

  nodeContainsChat(node) {
    if (node?.id === 'chat') {
      return true;
    }

    return Boolean(node?.querySelector?.('#chat'));
  }

  isConnected(node) {
    if (!node) {
      return false;
    }

    if (typeof node.isConnected === 'boolean') {
      return node.isConnected;
    }

    return Boolean(this.document.documentElement?.contains?.(node));
  }

  reprocessExistingMessages() {
    this.attachChatObserver();
    this.processMessages(this.chatList?.querySelectorAll?.('li') || [], true);
  }

  processMessages(messages, force = false) {
    for (const message of messages) {
      this.processMessage(message, force);
    }
  }

  processMessage(message, force = false) {
    const uid = normalizeUid(message?.getAttribute?.('uid'));
    if (!uid) {
      return;
    }

    const roles = this.roleRegistry?.getRoles?.(uid) || {
      vip: { active: false },
      admin: false,
    };
    const signature = `${uid}:${roles.admin ? 1 : 0}:${roles.vip.active ? 1 : 0}`;
    if (!force && message.dataset.blobioRoleSignature === signature) {
      return;
    }

    this.removeExtensionTags(message);
    const spans = Array.from(message.children || [])
      .filter((child) => String(child.tagName).toUpperCase() === 'SPAN');
    if (spans.length < 2) {
      return;
    }

    const username = spans[0];
    const messageSpan = spans.slice(1).find((span) => /^\s*:/.test(span.textContent || '')) || spans.at(-1);
    const messageIndex = spans.indexOf(messageSpan);
    const builtInTags = messageIndex > 1 ? spans.slice(1, messageIndex) : [];

    for (const tag of builtInTags) {
      if (String(tag.textContent || '').trim() === '[VIP]') {
        this.toggleClass(tag, 'blobio-chat-built-in-vip-hidden', roles.vip.active);
      }
    }

    this.toggleClass(username, 'blobio-chat-admin-username', roles.admin);
    this.toggleClass(messageSpan, 'blobio-chat-admin-message', roles.admin);

    if (roles.admin) {
      message.insertBefore(this.createTag(' [ADMIN]', 'blobio-chat-admin-tag'), messageSpan);
    }

    if (roles.vip.active) {
      const vipTag = this.createTag(' [VIP+]', 'blobio-chat-vip-plus-tag');
      if (roles.admin) {
        vipTag.classList.add('is-admin-combined');
      }
      message.insertBefore(vipTag, messageSpan);
    }

    message.dataset.blobioRoleSignature = signature;
  }

  createTag(text, className) {
    const tag = this.document.createElement('span');
    tag.classList.add(EXTENSION_TAG_CLASS, className);
    tag.textContent = text;
    return tag;
  }

  removeExtensionTags(message) {
    for (const tag of message.querySelectorAll?.(`.${EXTENSION_TAG_CLASS}`) || []) {
      tag.remove();
    }
  }

  toggleClass(node, className, enabled) {
    if (enabled) {
      node.classList.add(className);
    } else {
      node.classList.remove(className);
    }
  }

  destroy() {
    this.pageObserver?.disconnect();
    this.chatObserver?.disconnect();
    this.pageObserver = null;
    this.chatObserver = null;
    this.chatList = null;
    this.unsubscribeRoles?.();
    this.unsubscribeRoles = null;
    this.styleNode?.remove();
    this.styleNode = null;
    this.started = false;
  }
}
