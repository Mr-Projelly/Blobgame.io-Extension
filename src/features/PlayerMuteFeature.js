import { normalizeUid } from '../roles/RoleRegistry.js';
import { extractUidFromElement, findAngularUid } from '../roles/UidReader.js';

export { extractUidFromElement } from '../roles/UidReader.js';

const MENU_SELECTOR = '#mouseMenu';

const CONTEXT_DELAYS = [0, 40, 140, 320];

export function hasProtectedRoleText(element) {
  const text = String(element?.textContent || '');
  if (/\[(?:ADMIN|MD)\]/i.test(text)) {
    return true;
  }

  const roleNode = element?.querySelector?.([
    '.blobio-chat-admin-tag',
    '.blobio-chat-admin-username',
    '[data-role="admin"]',
    '[data-role="md"]',
    '[data-admin="true"]',
    '[data-moderator="true"]',
  ].join(','));
  return Boolean(roleNode);
}

export class PlayerMuteFeature {
  constructor({
    document = globalThis.document,
    mutedPlayersStore,
    roleRegistry,
    friendHighlightStore = null,
    notifications,
    logger = console,
  } = {}) {
    this.document = document;
    this.mutedPlayersStore = mutedPlayersStore;
    this.roleRegistry = roleRegistry;
    this.friendHighlightStore = friendHighlightStore;
    this.notifications = notifications;
    this.logger = logger;
    this.pageObserver = null;
    this.unsubscribeMutedPlayers = null;
    this.unsubscribeRoles = null;
    this.contextMenuHandler = null;
    this.pendingTarget = null;
    this.contextTimers = new Set();
    this.protectedUids = new Set();
    this.started = false;
  }

  start() {
    if (this.started || !this.document?.documentElement) {
      return Boolean(this.started);
    }

    this.contextMenuHandler = (event) => this.handleContextMenu(event);
    this.document.addEventListener?.('contextmenu', this.contextMenuHandler, true);
    this.unsubscribeMutedPlayers = this.mutedPlayersStore?.subscribe?.(() => this.syncInjectedButtons()) || null;
    this.unsubscribeRoles = this.roleRegistry?.subscribe?.(() => this.removeProtectedMutedPlayers()) || null;
    this.observeMenus();
    this.started = true;
    return true;
  }

  handleContextMenu(event) {
    const directTarget = this.readTargetFromEvent(event.target);
    this.pendingTarget = {
      ...directTarget,
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
      capturedAt: Date.now(),
    };

    this.rememberProtectedChatPlayers();
    if (!this.shouldInspectMenus()) {
      return;
    }

    this.scheduleMenuChecks();
  }

  readTargetFromEvent(target) {
    let current = target;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const uid = extractUidFromElement(current, false);
      if (uid) {
        return {
          uid,
          protected: hasProtectedRoleText(current),
          sourceElement: current,
        };
      }
      current = current.parentElement;
    }

    return { uid: '', protected: false, sourceElement: target || null };
  }

  scheduleMenuChecks() {
    const win = this.document.defaultView || globalThis;
    for (const delay of CONTEXT_DELAYS) {
      const timer = win.setTimeout?.(() => {
        this.contextTimers.delete(timer);
        const menu = this.findCurrentMenu();
        if (menu) {
          this.decorateMenu(menu);
        }
      }, delay);
      if (timer !== undefined) {
        this.contextTimers.add(timer);
      }
    }
  }

  observeMenus() {
    const MutationObserver = this.document.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!MutationObserver) {
      return;
    }

    this.pageObserver = new MutationObserver((mutations) => {
      if (!this.shouldInspectMenus()) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node?.nodeType !== 1) {
            continue;
          }

          if (node.matches?.(MENU_SELECTOR)) {
            this.decorateMenu(node);
          }
          for (const menu of node.querySelectorAll?.(MENU_SELECTOR) || []) {
            this.decorateMenu(menu);
          }
        }
      }
    });
    this.pageObserver.observe(this.document.documentElement, { childList: true, subtree: true });
  }

  findCurrentMenu() {
    const menu = this.document.getElementById?.('mouseMenu');
    return menu && this.isVisible(menu) ? menu : null;
  }

  isVisible(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const win = this.document.defaultView || globalThis;
    const style = win.getComputedStyle?.(element);
    return style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  decorateMenu(menu) {
    if (!menu || menu.id !== 'mouseMenu' || !this.shouldInspectMenus()) {
      return;
    }

    this.syncFriendStatusFromMenu(menu);
    if (!this.mutedPlayersStore?.isEnabled?.()) {
      return;
    }

    if (menu.querySelector?.('.blobio-mute-player-action')) {
      return;
    }

    const actionContainer = this.findActionContainer(menu);
    if (!actionContainer) {
      return;
    }

    const action = this.createMenuAction();
    action.addEventListener('click', () => this.muteCurrentTarget(menu));
    actionContainer.appendChild(action);
  }

  shouldInspectMenus() {
    return Boolean(
      this.mutedPlayersStore?.isEnabled?.()
      || this.friendHighlightStore?.isEnabled?.(),
    );
  }

  syncFriendStatusFromMenu(menu) {
    if (!this.friendHighlightStore?.isEnabled?.()) {
      return false;
    }

    const friendState = this.readFriendStateFromMenu(menu);
    if (!friendState) {
      return false;
    }

    const menuTarget = this.readTargetFromMenu(menu);
    const pending = this.pendingTarget && Date.now() - this.pendingTarget.capturedAt < 2500
      ? this.pendingTarget
      : null;
    const uid = menuTarget.uid || pending?.uid || '';
    if (!uid) {
      return false;
    }

    if (friendState === 'friend') {
      this.friendHighlightStore.addUid?.(uid);
    } else {
      this.friendHighlightStore.removeUid?.(uid);
    }

    return true;
  }

  readFriendStateFromMenu(menu) {
    const queue = Array.from(menu?.children || []);
    let inspected = 0;

    while (queue.length > 0 && inspected < 120) {
      const action = queue.shift();
      inspected += 1;

      if (!action?.classList?.contains?.('blobio-mute-player-action')) {
        const label = String(action?.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (/^in friends?$/.test(label)) {
          return 'friend';
        }
        if (/^add to friends?$/.test(label)) {
          return 'not-friend';
        }
      }

      queue.push(...Array.from(action?.children || []));
    }

    return '';
  }

  findActionContainer(menu) {
    return Array.from(menu?.children || [])
      .find((node) => String(node.tagName || '').toUpperCase() === 'UL') || null;
  }

  createMenuAction() {
    const action = this.document.createElement('li');
    action.classList.add('blobio-mute-player-action');
    action.textContent = 'Mute-Player';
    return action;
  }

  muteCurrentTarget(menu) {
    this.rememberProtectedChatPlayers();
    const menuTarget = this.readTargetFromMenu(menu);
    const pending = this.pendingTarget && Date.now() - this.pendingTarget.capturedAt < 2500
      ? this.pendingTarget
      : null;
    const uid = menuTarget.uid || pending?.uid || '';
    const protectedTarget = menuTarget.protected || pending?.protected || false;

    if (!uid) {
      this.notifications?.showMissingUidNotification?.();
      this.logger.warn?.('[Blobio] Mute-Player could not determine the selected player UID.');
      return;
    }

    if (protectedTarget || this.isProtectedUid(uid, menu, pending?.sourceElement)) {
      this.notifications?.showProtectedMuteNotification?.();
      return;
    }

    const added = this.mutedPlayersStore?.add?.(uid);
    if (added) {
      this.notifications?.showMutedPlayerNotification?.(uid);
    }
  }

  readTargetFromMenu(menu) {
    const playerName = menu?.querySelector?.('#playerName');
    const uid = extractUidFromElement(playerName, false);
    if (uid) {
      return { uid, protected: hasProtectedRoleText(playerName) || hasProtectedRoleText(menu) };
    }

    return this.readAngularTarget(menu);
  }

  readAngularTarget(menu) {
    const target = findAngularUid(menu);
    return {
      uid: target.uid,
      protected: target.value ? this.objectHasProtectedRole(target.value) : false,
    };
  }

  objectHasProtectedRole(value) {
    const booleanKeys = ['admin', 'isAdmin', 'moderator', 'isModerator', 'isMd', 'isMD', 'md'];
    for (const key of booleanKeys) {
      try {
        if (value[key] === true) {
          return true;
        }
      } catch {}
    }

    try {
      return /^(?:admin|md|moderator)$/i.test(String(value.role || value.tag || '').trim());
    } catch {
      return false;
    }
  }

  rememberProtectedChatPlayers() {
    const messages = this.document.querySelectorAll?.('#chat li[uid]') || [];
    for (const message of messages) {
      const uid = normalizeUid(message.getAttribute?.('uid'));
      if (uid && (hasProtectedRoleText(message) || this.roleRegistry?.isAdmin?.(uid))) {
        this.protectedUids.add(uid);
        if (this.mutedPlayersStore?.isMuted?.(uid)) {
          this.mutedPlayersStore.remove(uid);
        }
      }
    }
  }

  removeProtectedMutedPlayers() {
    const protectedPlayers = this.mutedPlayersStore?.getPlayers?.()
      .filter(({ uid }) => this.roleRegistry?.isAdmin?.(uid))
      .map(({ uid }) => uid) || [];
    if (protectedPlayers.length > 0) {
      this.mutedPlayersStore.remove(protectedPlayers);
    }
  }

  isProtectedUid(uid, ...elements) {
    if (this.roleRegistry?.isAdmin?.(uid) || this.protectedUids.has(uid)) {
      return true;
    }

    return elements.some((element) => hasProtectedRoleText(element));
  }

  syncInjectedButtons() {
    if (this.mutedPlayersStore?.isEnabled?.()) {
      return;
    }

    for (const button of this.document.querySelectorAll?.('.blobio-mute-player-action') || []) {
      button.remove();
    }
  }

  destroy() {
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.unsubscribeMutedPlayers?.();
    this.unsubscribeRoles?.();
    this.unsubscribeMutedPlayers = null;
    this.unsubscribeRoles = null;

    if (this.contextMenuHandler) {
      this.document.removeEventListener?.('contextmenu', this.contextMenuHandler, true);
      this.contextMenuHandler = null;
    }

    const win = this.document.defaultView || globalThis;
    for (const timer of this.contextTimers) {
      win.clearTimeout?.(timer);
    }
    this.contextTimers.clear();

    for (const button of this.document.querySelectorAll?.('.blobio-mute-player-action') || []) {
      button.remove();
    }

    this.pendingTarget = null;
    this.protectedUids.clear();
    this.started = false;
  }
}
