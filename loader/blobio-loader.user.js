// ==UserScript==
// @name         Blobio Web Script Loader
// @namespace    https://github.com/SkyViewBlobio/Blobgame.io-Extension
// @version      0.1.75
// @description  Loads the Blobio modular extension bundle from GitHub.
// @match        *://blobgame.io/*
// @match        *://custom.client.blobgame.io/*
// @run-at       document-start
// @sandbox      raw
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_getResourceURL
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @resource     BLOBIO_VIRUS_HALO https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/virus_glow_1%20_mask.png
// @resource     BLOBIO_VIRUS_ROTATE https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/viurs_glow_2_random_rotate_mask.png
// @resource     BLOBIO_VIRUS_RING https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/virus_glow_3%20_mask.png
// @downloadURL  https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/loader/blobio-loader.user.js
// @updateURL    https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/loader/blobio-loader.user.js
// ==/UserScript==

(() => {
  'use strict';

  const LOG_PREFIX = '[Blobio]';
  const VERSION = '0.1.75';
  const CUSTOM_CLIENT_HOST = 'custom.client.blobgame.io';
  const STORAGE_BRIDGE_SOURCE = 'BlobioExtensionStorageBridge';
  const CUSTOM_SKIN_ENABLED_KEY = 'blobio.customSkin.enabled';
  const CUSTOM_SKIN_ACTIVE_KEY = 'blobio.customSkin.activeUrl';
  const CUSTOM_SKIN_CARRIER_ASSET_KEY = 'blobio.customSkin.carrierAsset';
  const FPS_UNCAP_STORAGE_KEY = 'blobio.settings.fpsUncap';
  const VIRUS_MOTHER_CELL_KEYS = {
    enabled: 'blobio.settings.virusMotherCell.enabled',
    maskId: 'blobio.settings.virusMotherCell.maskId',
    color: 'blobio.settings.virusMotherCell.color',
    alpha: 'blobio.settings.virusMotherCell.alpha',
    rotate: 'blobio.settings.virusMotherCell.rotate',
  };
  const EARLY_HOTKEY_BRIDGE_KEY = '__blobioEarlyHotkeyBridge';
  const INPUT_KEYBOARD_ISOLATION_KEY = '__blobioExtensionInputKeyboardIsolationInstalled';
  const DIRECT_IMGUR_IMAGE_MATCH = /^https:\/\/i\.imgur\.com\/[a-z0-9]+\.(?:png|jpe?g|webp)(?:\?.*)?$/i;

  globalThis.__blobioLoaderVersion = VERSION;

  const BUNDLE_URLS = [
    `https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/dist/blobio-extension.bundle.js?v=${VERSION}`,
    `https://cdn.jsdelivr.net/gh/SkyViewBlobio/Blobgame.io-Extension@main/dist/blobio-extension.bundle.js?v=${VERSION}`,
  ];

  function logError(message, detail) {
    if (detail) {
      console.error(LOG_PREFIX, message, detail);
    } else {
      console.error(LOG_PREFIX, message);
    }
  }

  function getLocalValue(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setLocalValue(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {}
  }

  function removeLocalValue(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  function getSharedValue(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, undefined);
        if (value !== undefined && value !== null) {
          setLocalValue(key, value);
          return String(value);
        }
      }
    } catch {}

    return getLocalValue(key);
  }

  function setSharedValue(key, value) {
    try {
      GM_setValue?.(key, String(value));
    } catch {}
    setLocalValue(key, value);
  }

  function removeSharedValue(key) {
    try {
      GM_deleteValue?.(key);
    } catch {}
    removeLocalValue(key);
  }

  function isSharedStorageKey(key) {
    const value = String(key || '');
    return value.startsWith('blobio.customSkin.')
      || value.startsWith('blobio.roles.')
      || value.startsWith('blobio.settings.')
      || value.startsWith('blobio.chat.');
  }

  function installExtensionInputKeyboardIsolation() {
    if (location.hostname !== CUSTOM_CLIENT_HOST || globalThis[INPUT_KEYBOARD_ISOLATION_KEY]) {
      return;
    }

    const prototype = globalThis.EventTarget?.prototype;
    if (!prototype?.addEventListener || !prototype?.removeEventListener) {
      return;
    }

    const nativeAddEventListener = prototype.addEventListener;
    const nativeRemoveEventListener = prototype.removeEventListener;
    const keyboardEvents = new Set(['keydown', 'keypress', 'keyup']);
    const listenerWrappers = new WeakMap();

    const isGlobalKeyboardTarget = (target) => target === window
      || target === document
      || target === document.body;

    const isExtensionInput = (target) => {
      const input = target?.closest?.('input, textarea, select, [contenteditable="true"]');
      return Boolean(input?.closest?.('.blobio-chat-settings-root'));
    };

    const captureKey = (options) => {
      if (typeof options === 'boolean') {
        return options ? 'capture' : 'bubble';
      }
      return options?.capture ? 'capture' : 'bubble';
    };

    const getListenerMap = (target, type, options, create) => {
      let targetMap = listenerWrappers.get(target);
      if (!targetMap && create) {
        targetMap = new Map();
        listenerWrappers.set(target, targetMap);
      }
      if (!targetMap) {
        return null;
      }

      const key = `${type}:${captureKey(options)}`;
      let listeners = targetMap.get(key);
      if (!listeners && create) {
        listeners = new WeakMap();
        targetMap.set(key, listeners);
      }
      return listeners || null;
    };

    prototype.addEventListener = function blobioInputSafeAddEventListener(type, listener, options) {
      const listenerType = typeof listener;
      if (!keyboardEvents.has(type)
        || (listenerType !== 'function' && listenerType !== 'object')
        || !isGlobalKeyboardTarget(this)) {
        return nativeAddEventListener.call(this, type, listener, options);
      }

      const listeners = getListenerMap(this, type, options, true);
      let wrapped = listeners.get(listener);
      if (!wrapped) {
        wrapped = function blobioInputSafeKeyboardListener(event) {
          if (isExtensionInput(event?.target)) {
            return undefined;
          }

          if (typeof listener === 'function') {
            return listener.call(this, event);
          }
          return listener.handleEvent?.call(listener, event);
        };
        listeners.set(listener, wrapped);
      }

      return nativeAddEventListener.call(this, type, wrapped, options);
    };

    prototype.removeEventListener = function blobioInputSafeRemoveEventListener(type, listener, options) {
      const listenerType = typeof listener;
      const wrapped = keyboardEvents.has(type)
        && (listenerType === 'function' || listenerType === 'object')
        && isGlobalKeyboardTarget(this)
        ? getListenerMap(this, type, options, false)?.get(listener)
        : null;
      return nativeRemoveEventListener.call(this, type, wrapped || listener, options);
    };

    globalThis[INPUT_KEYBOARD_ISOLATION_KEY] = true;
  }

  function installEarlyKeyboardRuntime() {
    if (!globalThis[EARLY_HOTKEY_BRIDGE_KEY]) {
      let handler = null;
      const listener = (event) => {
        try {
          handler?.(event);
        } catch (error) {
          logError('Early keyboard hotkey handler failed.', error);
        }
      };

      window.addEventListener?.('keydown', listener, true);
      globalThis[EARLY_HOTKEY_BRIDGE_KEY] = {
        setHandler(nextHandler) {
          handler = typeof nextHandler === 'function' ? nextHandler : null;
        },
        clearHandler(currentHandler) {
          if (!currentHandler || handler === currentHandler) {
            handler = null;
          }
        },
      };
    }

    if (!globalThis.__blobioExtensionKeyboardShieldInstalled) {
      const blockGameKeybindings = (event) => {
        const target = event.target;
        if (!target?.closest?.('.blobio-chat-settings-root')) {
          return;
        }

        event.stopImmediatePropagation?.();
        event.stopPropagation?.();
      };

      for (const eventName of ['keydown', 'keypress', 'keyup']) {
        document.addEventListener?.(eventName, blockGameKeybindings, false);
      }
      globalThis.__blobioExtensionKeyboardShieldInstalled = true;
    }
  }

  function installSharedStorageBridge() {
    if (globalThis.__blobioSharedStorageBridgeInstalled) {
      return;
    }

    globalThis.__blobioSharedStorageBridge = {
      getItem(key) {
        return isSharedStorageKey(key) ? getSharedValue(key) : getLocalValue(key);
      },
      setItem(key, value) {
        if (isSharedStorageKey(key)) {
          setSharedValue(key, value);
        } else {
          setLocalValue(key, value);
        }
      },
      removeItem(key) {
        if (isSharedStorageKey(key)) {
          removeSharedValue(key);
        } else {
          removeLocalValue(key);
        }
      },
    };

    window.addEventListener?.('message', (event) => {
      const message = event.data;
      if (!message || message.source !== STORAGE_BRIDGE_SOURCE || !isSharedStorageKey(message.key)) {
        return;
      }

      if (message.type === 'set') {
        setSharedValue(message.key, message.value ?? '');
      } else if (message.type === 'remove') {
        removeSharedValue(message.key);
      }
    });

    globalThis.__blobioSharedStorageBridgeInstalled = true;
  }

  function normalizeCarrierAsset(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      return /\/skins\/[^/]+\/[^/]+\.png$/i.test(url.pathname) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function getCustomSkinState() {
    const activeUrl = String(getSharedValue(CUSTOM_SKIN_ACTIVE_KEY) || '').trim();
    const carrierAsset = normalizeCarrierAsset(getSharedValue(CUSTOM_SKIN_CARRIER_ASSET_KEY));
    const enabled = getSharedValue(CUSTOM_SKIN_ENABLED_KEY) === '1'
      && DIRECT_IMGUR_IMAGE_MATCH.test(activeUrl)
      && Boolean(carrierAsset);

    return {
      enabled,
      activeUrl: enabled ? activeUrl : '',
      carrierAsset: enabled ? carrierAsset : '',
    };
  }

  function pageCarrierSkinBootstrap(initialState, pageWindow) {
    'use strict';

    const rootWindow = pageWindow || globalThis;
    const installFlag = '__blobioCarrierSkinReplacerInstalled';
    const frameHookFlag = '__blobioCarrierSkinFrameHookInstalled';
    const state = rootWindow.__blobioCarrierSkinState || {
      enabled: false,
      activeUrl: '',
      carrierAsset: '',
    };
    const status = rootWindow.__blobioCarrierSkinStatusData || {
      windowsInstalled: 0,
      imageRequests: 0,
      fetchRequests: 0,
      xhrRequests: 0,
      replacements: 0,
      lastCarrierRequest: '',
      lastError: '',
    };

    Object.assign(state, initialState || {});
    rootWindow.__blobioCarrierSkinState = state;
    rootWindow.__blobioCarrierSkinStatusData = status;

    function parseUrl(value, win) {
      try {
        return new URL(String(value || ''), win.location.href);
      } catch {
        return null;
      }
    }

    function filenameFromPath(pathname) {
      const filename = String(pathname || '').slice(String(pathname || '').lastIndexOf('/') + 1);
      try {
        return decodeURIComponent(filename).toLowerCase();
      } catch {
        return filename.toLowerCase();
      }
    }

    function isCarrierUrl(value, win) {
      if (!state.enabled || !state.activeUrl || !state.carrierAsset || typeof value !== 'string') {
        return false;
      }

      const candidate = parseUrl(value.trim(), win);
      const carrier = parseUrl(state.carrierAsset, win);
      if (!candidate || !carrier) {
        return false;
      }

      if (candidate.pathname === carrier.pathname) {
        return true;
      }

      return /\/skins\//i.test(candidate.pathname)
        && filenameFromPath(candidate.pathname) === filenameFromPath(carrier.pathname);
    }

    function rewriteSkinUrl(value, win) {
      if (!isCarrierUrl(value, win)) {
        return value;
      }

      status.replacements += 1;
      status.lastCarrierRequest = String(value);
      return state.activeUrl;
    }

    function findDescriptor(prototype, propertyName) {
      let current = prototype;
      while (current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
        if (descriptor) {
          return descriptor;
        }
        current = Object.getPrototypeOf(current);
      }
      return null;
    }

    function installImageSrcHook(win) {
      if (!win.HTMLImageElement) {
        return;
      }

      const descriptor = findDescriptor(win.HTMLImageElement.prototype, 'src');
      if (!descriptor?.get || !descriptor?.set) {
        return;
      }

      Object.defineProperty(win.HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          const nextUrl = rewriteSkinUrl(value, win);
          if (nextUrl !== value) {
            status.imageRequests += 1;
            this.crossOrigin = 'anonymous';
          }
          descriptor.set.call(this, nextUrl);
        },
      });
    }

    function installSetAttributeHook(win) {
      if (!win.Element || typeof win.Element.prototype.setAttribute !== 'function') {
        return;
      }

      const originalSetAttribute = win.Element.prototype.setAttribute;
      win.Element.prototype.setAttribute = function setBlobioCarrierAttribute(name, value) {
        const isImageSource = this instanceof win.HTMLImageElement
          && typeof name === 'string'
          && name.toLowerCase() === 'src';

        if (!isImageSource) {
          return originalSetAttribute.call(this, name, value);
        }

        const nextUrl = rewriteSkinUrl(value, win);
        if (nextUrl !== value) {
          status.imageRequests += 1;
          this.crossOrigin = 'anonymous';
        }
        return originalSetAttribute.call(this, name, nextUrl);
      };
    }

    function installXhrHook(win) {
      if (!win.XMLHttpRequest || typeof win.XMLHttpRequest.prototype.open !== 'function') {
        return;
      }

      const originalOpen = win.XMLHttpRequest.prototype.open;
      win.XMLHttpRequest.prototype.open = function openBlobioCarrier(method, url, ...args) {
        const nextUrl = rewriteSkinUrl(url, win);
        if (nextUrl !== url) {
          status.xhrRequests += 1;
        }
        return originalOpen.call(this, method, nextUrl, ...args);
      };
    }

    function rewriteRequestInput(input, win) {
      if (typeof input === 'string') {
        return rewriteSkinUrl(input, win);
      }

      if (!input || typeof input.url !== 'string') {
        return input;
      }

      const nextUrl = rewriteSkinUrl(input.url, win);
      if (nextUrl === input.url || typeof win.Request !== 'function') {
        return input;
      }

      return new win.Request(nextUrl, input);
    }

    function installFetchHook(win) {
      if (typeof win.fetch !== 'function') {
        return;
      }

      const originalFetch = win.fetch;
      win.fetch = function fetchBlobioCarrier(input, init) {
        const nextInput = rewriteRequestInput(input, win);
        if (nextInput !== input) {
          status.fetchRequests += 1;
        }
        return originalFetch.call(this, nextInput, init);
      };
    }

    function installIntoFrame(frame) {
      if (!frame?.contentWindow) {
        return;
      }

      try {
        installIntoWindow(frame.contentWindow);
      } catch {
        // Ad and analytics frames may be cross-origin.
      }
    }

    function installFrameHooks(win) {
      if (!win.Node || win.Node.prototype[frameHookFlag]) {
        return;
      }

      Object.defineProperty(win.Node.prototype, frameHookFlag, { value: true });
      const originalAppendChild = win.Node.prototype.appendChild;
      const originalInsertBefore = win.Node.prototype.insertBefore;

      if (typeof originalAppendChild === 'function') {
        win.Node.prototype.appendChild = function appendBlobioNode(child) {
          const result = originalAppendChild.call(this, child);
          installIntoFrame(child);
          return result;
        };
      }

      if (typeof originalInsertBefore === 'function') {
        win.Node.prototype.insertBefore = function insertBlobioNode(child, referenceNode) {
          const result = originalInsertBefore.call(this, child, referenceNode);
          installIntoFrame(child);
          return result;
        };
      }
    }

    function observeFrames(win) {
      if (!win.MutationObserver || !win.document) {
        return;
      }

      const start = () => {
        const root = win.document.documentElement || win.document.body;
        if (!root) {
          return;
        }

        const observer = new win.MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              installIntoFrame(node);
              node.querySelectorAll?.('iframe')?.forEach(installIntoFrame);
            }
          }
        });

        observer.observe(root, { childList: true, subtree: true });
        win.addEventListener?.('load', () => {
          win.setTimeout?.(() => observer.disconnect(), 5000);
        }, { once: true });
      };

      if (win.document.documentElement || win.document.body) {
        start();
      } else {
        win.document.addEventListener?.('DOMContentLoaded', start, { once: true });
      }
    }

    function installIntoWindow(win) {
      if (!win || win[installFlag]) {
        return;
      }

      try {
        Object.defineProperty(win, installFlag, { value: true, configurable: true });
        installImageSrcHook(win);
        installSetAttributeHook(win);
        installXhrHook(win);
        installFetchHook(win);
        installFrameHooks(win);
        win.document?.querySelectorAll?.('iframe')?.forEach(installIntoFrame);
        observeFrames(win);
        status.windowsInstalled += 1;
      } catch (error) {
        status.lastError = error?.message || String(error);
      }
    }

    rootWindow.__blobioCarrierSkinRefresh = (nextState) => {
      Object.assign(state, {
        enabled: false,
        activeUrl: '',
        carrierAsset: '',
        ...(nextState || {}),
      });
    };
    rootWindow.__blobioCarrierSkinStatus = () => ({
      ...status,
      enabled: state.enabled,
      activeUrl: state.activeUrl,
      carrierAsset: state.carrierAsset,
      carrierFilename: filenameFromPath(parseUrl(state.carrierAsset, rootWindow)?.pathname || ''),
    });

    installIntoWindow(rootWindow);
  }

  function installCarrierSkinRuntime() {
    if (location.hostname !== CUSTOM_CLIENT_HOST) {
      return;
    }

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    try {
      pageCarrierSkinBootstrap(getCustomSkinState(), pageWindow);
    } catch (error) {
      logError('Failed to install the owned-skin asset replacement.', error);
      return;
    }

    const refresh = () => {
      try {
        pageWindow.__blobioCarrierSkinRefresh?.(getCustomSkinState());
      } catch (error) {
        logError('Failed to refresh Custom Skin state.', error);
      }
    };

    if (typeof GM_addValueChangeListener === 'function') {
      for (const key of [
        CUSTOM_SKIN_ENABLED_KEY,
        CUSTOM_SKIN_ACTIVE_KEY,
        CUSTOM_SKIN_CARRIER_ASSET_KEY,
      ]) {
        try {
          GM_addValueChangeListener(key, refresh);
        } catch {}
      }
    }

    window.addEventListener?.('message', (event) => {
      const message = event.data;
      if (message?.source === STORAGE_BRIDGE_SOURCE && [
        CUSTOM_SKIN_ENABLED_KEY,
        CUSTOM_SKIN_ACTIVE_KEY,
        CUSTOM_SKIN_CARRIER_ASSET_KEY,
      ].includes(message.key)) {
        refresh();
      }
    });
  }

  function pageFpsUncapBootstrap(initialEnabled, pageWindow) {
    'use strict';

    const win = pageWindow || globalThis;
    const doc = win.document;

    if (win.__blobFpsUncapInstalled) {
      win.__blobioFpsUncapRefresh?.(initialEnabled);
      return;
    }

    const config = {
      enabled: Boolean(initialEnabled),
      mode: 'safe-uncapped',
      startupDelayMs: 5000,
      yieldEveryFrames: 120,
      preserveCameraZoom: true,
      cameraDeltaFloor: 0.003000000026077032,
      minCameraDeltaSeconds: 0.0001,
      keepVisible: true,
      log: false,
    };

    const state = {
      installed: false,
      callbacksScheduled: 0,
      callbacksRun: 0,
      nativeFramesScheduled: 0,
      pendingFrames: 0,
      uncappedFramesSinceYield: 0,
      currentFrameDeltaSeconds: 1 / 240,
      scheduler: 'message-channel',
      lastError: '',
    };

    win.__blobFpsUncap = config;
    win.__blobioFpsUncapState = state;

    function log(...args) {
      if (config.log && win.console) {
        win.console.info('[Blob FPS Uncap]', ...args);
      }
    }

    function now() {
      return win.performance?.now?.() ?? Date.now();
    }

    const native = {
      requestAnimationFrame: typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame.bind(win)
        : (callback) => win.setTimeout(() => callback(now()), 16),
      cancelAnimationFrame: typeof win.cancelAnimationFrame === 'function'
        ? win.cancelAnimationFrame.bind(win)
        : win.clearTimeout.bind(win),
      setTimeout: win.setTimeout.bind(win),
      clearTimeout: win.clearTimeout.bind(win),
      addEventListener: win.EventTarget?.prototype?.addEventListener,
      mathMax: win.Math.max.bind(win.Math),
      mathAbs: win.Math.abs.bind(win.Math),
      hasFocus: typeof doc?.hasFocus === 'function' ? doc.hasFocus.bind(doc) : null,
    };

    const pendingFrames = new Map();
    const nativeFrames = new Set();
    const installedAt = now();
    let nextFrameId = 0x40000000;
    let uncappedFramesSinceYield = 0;
    let insideFrameCallback = false;
    let lastFrameTime = 0;
    let currentFrameDeltaSeconds = 1 / 240;
    let messageChannel = null;

    function isActive() {
      return config.enabled && config.mode !== 'native';
    }

    function beginFrame(timestamp) {
      const frameTime = typeof timestamp === 'number' ? timestamp : now();
      if (lastFrameTime > 0) {
        currentFrameDeltaSeconds = native.mathMax(
          (frameTime - lastFrameTime) / 1000,
          config.minCameraDeltaSeconds,
        );
      }
      lastFrameTime = frameTime;
      insideFrameCallback = true;
      state.currentFrameDeltaSeconds = currentFrameDeltaSeconds;
      return frameTime;
    }

    function endFrame() {
      insideFrameCallback = false;
    }

    function patchCameraDeltaFloor() {
      if (!config.preserveCameraZoom || win.Math.__blobFpsUncapMaxPatched) {
        return;
      }

      const originalMax = win.Math.max;
      const patchedMax = function blobFpsUncapMathMax(...values) {
        if (
          isActive()
          && insideFrameCallback
          && values.length === 2
          && typeof values[0] === 'number'
          && typeof values[1] === 'number'
          && values[0] >= 0
          && values[0] < config.cameraDeltaFloor
          && native.mathAbs(values[1] - config.cameraDeltaFloor) < 1e-12
        ) {
          return currentFrameDeltaSeconds;
        }

        return native.mathMax(...values);
      };

      patchedMax.__blobFpsUncapOriginal = originalMax;
      win.Math.max = patchedMax;
      win.Math.__blobFpsUncapMaxPatched = true;
    }

    function runFrame(id) {
      const frame = pendingFrames.get(id);
      if (!frame) {
        return;
      }

      pendingFrames.delete(id);
      state.pendingFrames = pendingFrames.size;

      if (!isActive()) {
        requestNativeFrame(frame.callback);
        return;
      }

      const timestamp = beginFrame(now());
      try {
        state.callbacksRun += 1;
        frame.callback(timestamp);
      } catch (error) {
        state.lastError = error?.message || String(error);
        throw error;
      } finally {
        endFrame();
      }
    }

    function requestUncappedFrame(callback) {
      const id = nextFrameId;
      nextFrameId = nextFrameId >= 0x7ffffffe ? 0x40000000 : nextFrameId + 1;
      const frame = { callback, timer: null };

      pendingFrames.set(id, frame);
      state.callbacksScheduled += 1;
      state.pendingFrames = pendingFrames.size;

      if (messageChannel) {
        messageChannel.port2.postMessage(id);
      } else {
        frame.timer = native.setTimeout(() => runFrame(id), 0);
      }

      return id;
    }

    function cancelUncappedFrame(id) {
      const frame = pendingFrames.get(id);
      if (!frame) {
        return false;
      }

      if (frame.timer !== null) {
        native.clearTimeout(frame.timer);
      }
      pendingFrames.delete(id);
      state.pendingFrames = pendingFrames.size;
      return true;
    }

    function requestNativeFrame(callback) {
      let id = 0;
      id = native.requestAnimationFrame((timestamp) => {
        nativeFrames.delete(id);
        uncappedFramesSinceYield = 0;
        state.uncappedFramesSinceYield = 0;

        const frameTime = beginFrame(timestamp);
        try {
          state.callbacksRun += 1;
          callback(frameTime);
        } catch (error) {
          state.lastError = error?.message || String(error);
          throw error;
        } finally {
          endFrame();
        }
      });
      nativeFrames.add(id);
      state.callbacksScheduled += 1;
      state.nativeFramesScheduled += 1;
      return id;
    }

    function shouldUseNativeFrame() {
      if (!isActive()) {
        return true;
      }
      if (config.mode !== 'safe-uncapped') {
        return false;
      }
      if (doc && doc.readyState !== 'complete') {
        return true;
      }
      if (now() - installedAt < config.startupDelayMs) {
        return true;
      }

      return config.yieldEveryFrames > 0
        && uncappedFramesSinceYield >= config.yieldEveryFrames;
    }

    function flushPendingFramesToNative() {
      if (pendingFrames.size === 0) {
        return;
      }

      const callbacks = [...pendingFrames.values()].map((frame) => frame.callback);
      for (const frame of pendingFrames.values()) {
        if (frame.timer !== null) {
          native.clearTimeout(frame.timer);
        }
      }
      pendingFrames.clear();
      state.pendingFrames = 0;

      for (const callback of callbacks) {
        requestNativeFrame(callback);
      }
    }

    function findDescriptor(target, key) {
      let current = target;
      while (current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor) {
          return descriptor;
        }
        current = Object.getPrototypeOf(current);
      }
      return null;
    }

    function patchDocumentVisibility(key, visibleValue) {
      if (!doc) {
        return;
      }

      const descriptor = findDescriptor(doc, key);
      try {
        Object.defineProperty(doc, key, {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get() {
            if (isActive() && config.keepVisible) {
              return visibleValue;
            }
            if (typeof descriptor?.get === 'function') {
              return descriptor.get.call(doc);
            }
            return descriptor?.value;
          },
        });
      } catch (error) {
        log('could not patch', key, error);
      }
    }

    function installVisibilityProtection() {
      if (!config.keepVisible || !doc) {
        return;
      }

      patchDocumentVisibility('hidden', false);
      patchDocumentVisibility('webkitHidden', false);
      patchDocumentVisibility('visibilityState', 'visible');
      patchDocumentVisibility('webkitVisibilityState', 'visible');

      if (native.hasFocus) {
        try {
          doc.hasFocus = function blobFpsUncapHasFocus() {
            return isActive() ? true : native.hasFocus();
          };
        } catch (error) {
          log('could not patch hasFocus', error);
        }
      }

      if (!native.addEventListener || !win.EventTarget) {
        return;
      }

      const blockedEvents = [
        'visibilitychange',
        'webkitvisibilitychange',
        'blur',
        'freeze',
      ];
      const stopPageThrottleEvent = (event) => {
        if (isActive()) {
          event.stopImmediatePropagation();
        }
      };

      for (const eventName of blockedEvents) {
        native.addEventListener.call(win, eventName, stopPageThrottleEvent, true);
        native.addEventListener.call(doc, eventName, stopPageThrottleEvent, true);
      }
    }

    patchCameraDeltaFloor();
    installVisibilityProtection();

    if (typeof win.MessageChannel === 'function') {
      messageChannel = new win.MessageChannel();
      messageChannel.port1.onmessage = (event) => runFrame(event.data);
      messageChannel.port1.start?.();
    } else {
      state.scheduler = 'timeout-fallback';
    }

    win.requestAnimationFrame = function blobFpsUncapRequestAnimationFrame(callback) {
      if (typeof callback !== 'function') {
        return 0;
      }

      if (shouldUseNativeFrame()) {
        return requestNativeFrame(callback);
      }

      uncappedFramesSinceYield += 1;
      state.uncappedFramesSinceYield = uncappedFramesSinceYield;
      return requestUncappedFrame(callback);
    };

    win.cancelAnimationFrame = function blobFpsUncapCancelAnimationFrame(id) {
      if (cancelUncappedFrame(id)) {
        return;
      }

      if (nativeFrames.delete(id)) {
        native.cancelAnimationFrame(id);
      }
    };

    win.webkitRequestAnimationFrame = win.requestAnimationFrame;
    win.mozRequestAnimationFrame = win.requestAnimationFrame;
    win.msRequestAnimationFrame = win.requestAnimationFrame;
    win.webkitCancelAnimationFrame = win.cancelAnimationFrame;
    win.mozCancelAnimationFrame = win.cancelAnimationFrame;
    win.msCancelAnimationFrame = win.cancelAnimationFrame;

    win.__blobFpsUncapInstalled = true;
    win.__blobioFpsUncapInstalled = true;
    state.installed = true;

    win.__blobioFpsUncapRefresh = (enabled) => {
      const nextEnabled = Boolean(enabled);
      if (config.enabled === nextEnabled) {
        return;
      }

      config.enabled = nextEnabled;
      state.lastError = '';

      if (!nextEnabled) {
        uncappedFramesSinceYield = 0;
        state.uncappedFramesSinceYield = 0;
        flushPendingFramesToNative();
      }
    };

    win.__blobioFpsUncapStatus = () => ({
      enabled: config.enabled,
      installed: state.installed,
      mode: config.mode,
      startupDelayMs: config.startupDelayMs,
      yieldEveryFrames: config.yieldEveryFrames,
      preserveCameraZoom: config.preserveCameraZoom,
      keepVisible: config.keepVisible,
      scheduler: state.scheduler,
      callbacksScheduled: state.callbacksScheduled,
      callbacksRun: state.callbacksRun,
      nativeFramesScheduled: state.nativeFramesScheduled,
      pendingFrames: state.pendingFrames,
      uncappedFramesSinceYield: state.uncappedFramesSinceYield,
      currentFrameDeltaSeconds: state.currentFrameDeltaSeconds,
      lastError: state.lastError,
    });

    log(
      'installed',
      `enabled=${config.enabled}`,
      `mode=${config.mode}`,
      `startupDelayMs=${config.startupDelayMs}`,
      `yieldEveryFrames=${config.yieldEveryFrames}`,
      `preserveCameraZoom=${config.preserveCameraZoom}`,
      `scheduler=${state.scheduler}`,
    );
  }

  /* VIRUS_RUNTIME_START */
  function pageVirusMotherCellBootstrap(initialConfig, pageWindow) {
    'use strict';

    const win = pageWindow || globalThis;
    const doc = win.document;
    const config = normalizeConfig(initialConfig);
    if (!config.enabled || win.location?.hostname !== 'custom.client.blobgame.io') {
      return false;
    }

    const INSTALL_KEY = '__blobioVirusMotherCellInstalled';
    if (win[INSTALL_KEY]) {
      return true;
    }
    win[INSTALL_KEY] = true;

    const CACHE_SCRIPT_RE = /\/html\/[a-f0-9]{32}\.cache\.js(?:[?#].*)?$/i;
    const GLOW_MASK_RE = /(?:^|\/)(?:assets\/)?skins\/system\/_glow_mask\.png(?:[?#].*)?$/i;
    const RENDER_LOOP_RE = /var b,c,d,e,f,g,h;for\(e=0;e<\(([$A-Za-z_][$\w]*)\(\),([$A-Za-z_][$\w]*)\)\.d\.a\.length;e\+\+\)\{/;
    const RENDER_CELL_RE = /g=[$A-Za-z_][$\w]*\([$A-Za-z_][$\w]*\.d,e\);if\(!a\.c\|\|!g\|\|!g\.K\|\|!g\.c\)\{continue\}[$A-Za-z_][$\w]*\(g\);/;
    const VIRUS_BRANCH_RE = /case 4:case 3:if\(g\.q\)\{if\(g\.P\)\{h=g\.P;([$A-Za-z_][$\w]*)\(\);([$A-Za-z_][$\w]*)\(a\.c,g\.K\);([$A-Za-z_][$\w]*)\(a\.c,h,g\.R-g\.M,g\.S-g\.M,g\.N,g\.N\)\}\}else\{\1\(\);\2\(a\.c,g\.K\);\3\(a\.c,(a\.[$A-Za-z_][$\w]*),g\.R-g\.M,g\.S-g\.M,g\.N,g\.N\)\}break;/;
    const FALLBACK_RENDER_RE = /function ([$A-Za-z_][$\w]*)\(a,b\)\{var c;if\(b\.q\)\{c=b\.P;([$A-Za-z_][$\w]*)\(\);([$A-Za-z_][$\w]*)\(a\.c,b\.K\);([$A-Za-z_][$\w]*)\(a\.c,c,b\.R-b\.M,b\.S-b\.M,b\.N,b\.N\)\}else if\(b\.P\)\{\3\(a\.c,b\.K\);\4\(a\.c,b\.P,b\.R-b\.M,b\.S-b\.M,b\.N,b\.N\)\}else\{b\.K\.a=0\.75;\3\(a\.c,b\.K\);\4\(a\.c,([$A-Za-z_][$\w]*),b\.R-b\.M,b\.S-b\.M,b\.N,b\.N\)\}\}/;
    const ROTATED_DRAW_RE = /function ([$A-Za-z_][$\w]*)\(a,b,c,d,e,f,g,h,i,j,k\)\{var [^;]+;if\(!a\.j\)throw [^;]+;[$A-Za-z_][$\w]*=a\.C;[$A-Za-z_][$\w]*=b\.v;[^{}]*?=c\+e;[^{}]*?=d\+f;[^{}]*?=-e;[^{}]*?=-f;/;

    const settings = {
      maskId: config.maskId,
      maskUrl: config.maskUrl,
      rotate: config.maskId === 'rotate' && config.rotate,
      color: config.color,
      alpha: config.alpha,
      r: parseInt(config.color.slice(1, 3), 16) / 255,
      g: parseInt(config.color.slice(3, 5), 16) / 255,
      b: parseInt(config.color.slice(5, 7), 16) / 255,
    };
    win.__blobVirusGlowSettings = settings;

    const state = win.__blobVirusGlowState || {
      callbackCalls: 0,
      version: config.version || '',
      glowMaskAssetHits: 0,
      glowMaskTextureUploads: 0,
      customMaskReady: false,
      customMaskErrors: 0,
      rotationDraws: 0,
      rotationStateChecks: 0,
      rotationHighDetailDraws: 0,
      rotationFallbackDraws: 0,
      rotationTextureDraws: 0,
      rotationGlowTextureDraws: 0,
      highDetailGlowDraws: 0,
      fallbackGlowDraws: 0,
      nonRotatedHighDetailDraws: 0,
      nonRotatedFallbackDraws: 0,
      rotateChecks: 0,
      rotateMaskActive: settings.rotate,
      lastRotateMaskId: settings.maskId,
      glowTextureDraws: 0,
      frame: 0,
      viruses: [],
      cellTypes: {},
      fallbackVirusHits: 0,
      highDetailVirusHits: 0,
      skippedVirusTextureDraws: 0,
      textureVirusHits: 0,
      virusTextureDraws: 0,
      patchedChunks: 0,
      seenCacheScripts: 0,
      wrappedCallback: false,
      errors: [],
      lastPatchResult: null,
      lastPatchRotateSelected: false,
      rotatedDrawName: null,
      lastUpdate: 0,
    };
    state.version = config.version || state.version;
    state.cellTypes ||= {};
    state.rotateMaskActive = settings.rotate;
    state.lastRotateMaskId = settings.maskId;
    win.__blobVirusGlowState = state;

    let customGlowMaskImage = null;
    let customGlowMaskUrl = '';

    preloadCustomGlowMask();
    installGlowMaskTexturePatch();
    installGlowMaskAssetPatch();
    installRotationHelpers();
    installDebugSnapshot();

    const NodeCtor = win.Node;
    if (!NodeCtor?.prototype) {
      return false;
    }

    const nativeAppendChild = NodeCtor.prototype.appendChild;
    const nativeInsertBefore = NodeCtor.prototype.insertBefore;

    function normalizeConfig(value) {
      const color = typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
        ? value.color.toLowerCase()
        : '#ff0000';
      const rawAlpha = Number(value?.alpha);
      return {
        enabled: Boolean(value?.enabled),
        maskId: ['halo', 'rotate', 'ring'].includes(value?.maskId) ? value.maskId : 'halo',
        maskUrl: String(value?.maskUrl || ''),
        color,
        alpha: Number.isFinite(rawAlpha) ? Math.max(0, Math.min(1, rawAlpha)) : 0.85,
        rotate: Boolean(value?.rotate),
        version: String(value?.version || ''),
      };
    }

    function preloadCustomGlowMask() {
      getCustomGlowMaskImage();
    }

    function getCustomGlowMaskImage() {
      if (customGlowMaskImage && customGlowMaskUrl === settings.maskUrl) {
        return customGlowMaskImage;
      }

      const ImageCtor = win.Image || win.HTMLImageElement;
      if (typeof ImageCtor !== 'function' || !settings.maskUrl) {
        return null;
      }

      const image = new ImageCtor();
      if (!settings.maskUrl.startsWith('data:') && !settings.maskUrl.startsWith('blob:')) {
        image.crossOrigin = 'anonymous';
      }
      customGlowMaskImage = image;
      customGlowMaskUrl = settings.maskUrl;
      state.customMaskReady = false;
      image.onload = () => {
        state.customMaskReady = true;
      };
      image.onerror = () => {
        state.customMaskErrors = (state.customMaskErrors + 1) || 1;
      };
      image.src = settings.maskUrl;

      if (image.complete || image.naturalWidth > 0 || image.width > 0) {
        state.customMaskReady = true;
      }
      return image;
    }

    function installGlowMaskTexturePatch() {
      patchWebGLTextureUpload(win.WebGLRenderingContext);
      patchWebGLTextureUpload(win.WebGL2RenderingContext);
    }

    function patchWebGLTextureUpload(ContextCtor) {
      if (!ContextCtor?.prototype || ContextCtor.prototype.__blobVirusGlowTexImagePatched) {
        return;
      }
      const nativeTexImage2D = ContextCtor.prototype.texImage2D;
      if (typeof nativeTexImage2D !== 'function') {
        return;
      }

      ContextCtor.prototype.texImage2D = function patchedTexImage2D(...args) {
        const sourceIndex = findTextureSourceIndex(args);
        if (sourceIndex !== -1 && isGlowMaskSource(args[sourceIndex])) {
          const replacement = getCustomGlowMaskImage();
          if (replacement) {
            state.glowMaskTextureUploads = (state.glowMaskTextureUploads + 1) || 1;
            state.lastGlowMaskUploadSource = getTextureSourceUrl(args[sourceIndex]);
            args[sourceIndex] = replacement;
          }
        }
        return nativeTexImage2D.apply(this, args);
      };
      ContextCtor.prototype.__blobVirusGlowTexImagePatched = true;
    }

    function findTextureSourceIndex(args) {
      for (let index = args.length - 1; index >= 0; index -= 1) {
        if (isTextureSource(args[index])) {
          return index;
        }
      }
      return -1;
    }

    function isTextureSource(value) {
      return Boolean(value && typeof value === 'object'
        && ('src' in value || 'currentSrc' in value || 'tagName' in value || 'naturalWidth' in value));
    }

    function isGlowMaskSource(source) {
      return GLOW_MASK_RE.test(getTextureSourceUrl(source));
    }

    function getTextureSourceUrl(source) {
      if (!source) {
        return '';
      }
      return String(source.currentSrc || source.src || source.getAttribute?.('src') || '');
    }

    function installGlowMaskAssetPatch() {
      const ImageCtor = win.HTMLImageElement;
      if (!ImageCtor?.prototype) {
        return;
      }

      const imageProto = ImageCtor.prototype;
      const srcDescriptor = findPropertyDescriptor(imageProto, 'src');
      if (srcDescriptor?.set && !imageProto.__blobVirusGlowSrcPatched) {
        Object.defineProperty(imageProto, 'src', {
          get: srcDescriptor.get,
          set(value) {
            const nextValue = rewriteGlowMaskUrl(value);
            if (nextValue !== value && !nextValue.startsWith('data:') && !nextValue.startsWith('blob:')) {
              this.crossOrigin = 'anonymous';
            }
            return srcDescriptor.set.call(this, nextValue);
          },
          configurable: true,
          enumerable: srcDescriptor.enumerable,
        });
        imageProto.__blobVirusGlowSrcPatched = true;
      }

      const ElementCtor = win.Element;
      if (!ElementCtor?.prototype || ElementCtor.prototype.__blobVirusGlowSetAttributePatched) {
        return;
      }
      const nativeSetAttribute = ElementCtor.prototype.setAttribute;
      ElementCtor.prototype.setAttribute = function patchedSetAttribute(name, value) {
        const isImage = this instanceof ImageCtor || String(this.tagName).toUpperCase() === 'IMG';
        if (String(name).toLowerCase() === 'src' && isImage) {
          const nextValue = rewriteGlowMaskUrl(value);
          if (nextValue !== value && !nextValue.startsWith('data:') && !nextValue.startsWith('blob:')) {
            this.crossOrigin = 'anonymous';
          }
          return nativeSetAttribute.call(this, name, nextValue);
        }
        return nativeSetAttribute.call(this, name, value);
      };
      ElementCtor.prototype.__blobVirusGlowSetAttributePatched = true;
    }

    function rewriteGlowMaskUrl(value) {
      if (typeof value !== 'string' || !GLOW_MASK_RE.test(value)) {
        return value;
      }
      state.glowMaskAssetHits = (state.glowMaskAssetHits + 1) || 1;
      return settings.maskUrl;
    }

    function findPropertyDescriptor(proto, property) {
      let current = proto;
      while (current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, property);
        if (descriptor) {
          return descriptor;
        }
        current = Object.getPrototypeOf(current);
      }
      return null;
    }

    function installRotationHelpers() {
      const rotations = new Map();
      win.__blobVirusGlowShouldRotate = function shouldRotate() {
        state.rotateChecks = (state.rotateChecks + 1) || 1;
        return settings.rotate;
      };
      win.__blobVirusGlowGetRotation = function getRotation(id, x, y) {
        const hasId = id !== null && id !== undefined && id !== '';
        const key = hasId ? String(id) : `${Math.round(Number(x) || 0)}:${Math.round(Number(y) || 0)}`;
        if (rotations.has(key)) {
          return rotations.get(key);
        }
        let hash = 2166136261;
        for (let index = 0; index < key.length; index += 1) {
          hash ^= key.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        const rotation = Math.abs(hash % 360);
        rotations.set(key, rotation);
        return rotation;
      };
      win.__blobVirusGlowGetDrawRotation = function getDrawRotation(id, x, y, sourceName) {
        const source = sourceName === 'fallback' ? 'fallback' : 'high-detail';
        state.rotationStateChecks = (state.rotationStateChecks + 1) || 1;
        if (!settings.rotate) {
          state.lastRotationSkippedSource = source;
          return 0;
        }
        const rotation = win.__blobVirusGlowGetRotation(id, x, y);
        state.rotationDraws = (state.rotationDraws + 1) || 1;
        if (source === 'fallback') {
          state.rotationFallbackDraws = (state.rotationFallbackDraws + 1) || 1;
        } else {
          state.rotationHighDetailDraws = (state.rotationHighDetailDraws + 1) || 1;
        }
        state.lastRotation = rotation;
        state.lastRotationSource = source;
        state.lastRotationMaskId = settings.maskId;
        return rotation;
      };
    }

    function installDebugSnapshot() {
      win.__blobVirusGlowDebug = function debugSnapshot() {
        return {
          version: state.version,
          enabled: true,
          maskId: settings.maskId,
          shouldRotate: settings.rotate,
          callbackCalls: state.callbackCalls,
          patchedChunks: state.patchedChunks,
          seenCacheScripts: state.seenCacheScripts,
          lastPatchResult: state.lastPatchResult,
          customMaskReady: state.customMaskReady,
          customMaskErrors: state.customMaskErrors,
          highDetailVirusHits: state.highDetailVirusHits,
          fallbackVirusHits: state.fallbackVirusHits,
          textureVirusHits: state.textureVirusHits,
          rotationDraws: state.rotationDraws,
          errors: state.errors,
        };
      };
    }

    function patchBundle(source) {
      let code = source;
      const branchMatch = code.match(VIRUS_BRANCH_RE);
      const drawRegionName = branchMatch ? branchMatch[3] : null;
      const rotatedDrawName = rememberRotatedDrawFunction(code) || state.rotatedDrawName;
      const glowTexture = findGlowTextureFromAsset(code) || 'a.n';
      const virusTexture = branchMatch ? branchMatch[4] : 'a.A';
      let renderLoopPatched = false;
      let renderCellPatched = false;
      let virusBranchPatched = false;
      let fallbackRenderPatched = false;
      let textureDrawPatched = false;

      if (RENDER_LOOP_RE.test(code)) {
        code = code.replace(RENDER_LOOP_RE, (match) => match.replace(
          ';for(',
          `;if($wnd.__blobVirusGlowState){$wnd.__blobVirusGlowState.frame=($wnd.__blobVirusGlowState.frame+1)||1;$wnd.__blobVirusGlowState.viruses.length=0;$wnd.__blobVirusGlowState.currentCell=null;$wnd.__blobVirusGlowState.virusTexture=${virusTexture};$wnd.__blobVirusGlowState.glowTexture=${glowTexture};}for(`,
        ));
        renderLoopPatched = true;
      }

      if (RENDER_CELL_RE.test(code)) {
        code = code.replace(RENDER_CELL_RE, (match) => match
          + 'h=$wnd.__blobVirusGlowState;'
          + 'if(h){h.currentCell=g;h.cellTypes||(h.cellTypes={});h.cellTypes[g.c.M]=(h.cellTypes[g.c.M]+1)||1}');
        renderCellPatched = true;
      }

      if (VIRUS_BRANCH_RE.test(code)) {
        code = code.replace(VIRUS_BRANCH_RE, (match, initDrawState, setColor, drawRegion, branchVirusTexture, offset, fullCode) => {
          const branchGlowTexture = findGlowTextureFromAsset(fullCode) || findGlowTexture(fullCode, offset + match.length, drawRegion);
          const drawGlow = buildGlowDrawCall(rotatedDrawName, drawRegion, 'g', 'a.c', branchGlowTexture, 'high-detail');
          return 'case 4:case 3:'
            + 'h=$wnd.__blobVirusGlowState;'
            + 'if(h){h.viruses.push({id:g.n,x:g.R,y:g.S,r:g.M,size:g.N,mode:1,type:g.c.M});h.highDetailVirusHits=(h.highDetailVirusHits+1)||1;h.lastUpdate=(new Date).getTime()}'
            + 'h=$wnd.__blobVirusGlowSettings;f=g.K.d;d=g.K.c;b=g.K.b;c=g.K.a;'
            + 'g.K.d=h&&h.r!=null?h.r:1;g.K.c=h&&h.g!=null?h.g:0;g.K.b=h&&h.b!=null?h.b:0;g.K.a=h&&h.alpha!=null?h.alpha:0.85;'
            + `${initDrawState}();${setColor}(a.c,g.K);${drawGlow};`
            + 'g.K.d=f;g.K.c=d;g.K.b=b;g.K.a=c;break;';
        });
        virusBranchPatched = true;
      }

      if (FALLBACK_RENDER_RE.test(code)) {
        code = code.replace(FALLBACK_RENDER_RE, (match, fallbackName, initDrawState, setColor, drawRegion, defaultTexture, offset, fullCode) => {
          const fallbackGlowTexture = findGlowTextureFromAsset(fullCode) || 'a.n';
          const drawGlow = buildGlowDrawCall(rotatedDrawName, drawRegion, 'b', 'a.c', fallbackGlowTexture, 'fallback');
          return `function ${fallbackName}(a,b){var c,d,e,f,g;if(b.c&&(b.c.M==4||b.c.M==3)){`
            + 'c=$wnd.__blobVirusGlowState;'
            + 'if(c){c.viruses.push({id:b.n,x:b.R,y:b.S,r:b.M,size:b.N,mode:0,type:b.c.M});c.fallbackVirusHits=(c.fallbackVirusHits+1)||1;c.lastUpdate=(new Date).getTime()}'
            + 'c=$wnd.__blobVirusGlowSettings;d=b.K.d;e=b.K.c;f=b.K.b;g=b.K.a;'
            + 'b.K.d=c&&c.r!=null?c.r:1;b.K.c=c&&c.g!=null?c.g:0;b.K.b=c&&c.b!=null?c.b:0;b.K.a=c&&c.alpha!=null?c.alpha:0.85;'
            + `${initDrawState}();${setColor}(a.c,b.K);${drawGlow};`
            + 'b.K.d=d;b.K.c=e;b.K.b=f;b.K.a=g;return}'
            + `if(b.q){c=b.P;${initDrawState}();${setColor}(a.c,b.K);${drawRegion}(a.c,c,b.R-b.M,b.S-b.M,b.N,b.N)}`
            + `else if(b.P){${setColor}(a.c,b.K);${drawRegion}(a.c,b.P,b.R-b.M,b.S-b.M,b.N,b.N)}`
            + `else{b.K.a=0.75;${setColor}(a.c,b.K);${drawRegion}(a.c,${defaultTexture},b.R-b.M,b.S-b.M,b.N,b.N)}}`;
        });
        fallbackRenderPatched = true;
      }

      if (drawRegionName) {
        const patchedDrawRegion = patchDrawRegionFunction(code, drawRegionName, rotatedDrawName);
        code = patchedDrawRegion.code;
        textureDrawPatched = patchedDrawRegion.changed;
      }

      const result = {
        code,
        changed: renderLoopPatched || renderCellPatched || virusBranchPatched || fallbackRenderPatched || textureDrawPatched,
        renderLoopPatched,
        renderCellPatched,
        virusBranchPatched,
        fallbackRenderPatched,
        textureDrawPatched,
        rotatedDrawPatched: Boolean(rotatedDrawName),
      };
      state.lastPatchResult = { ...result, code: undefined };
      return result;
    }

    state.patchBundle = patchBundle;

    function buildGlowDrawCall(rotatedDrawName, drawRegion, cellName, batchName, textureName, sourceName) {
      const normalDraw = `${drawRegion}(${batchName},${textureName},${cellName}.R-${cellName}.M*2,${cellName}.S-${cellName}.M*2,${cellName}.N*2,${cellName}.N*2)`;
      const isFallback = sourceName === 'fallback';
      const drawCounter = isFallback ? 'fallbackGlowDraws' : 'highDetailGlowDraws';
      const nonRotatedCounter = isFallback ? 'nonRotatedFallbackDraws' : 'nonRotatedHighDetailDraws';
      const lastCell = isFallback ? 'lastFallbackCell' : 'lastHighDetailCell';
      const markDraw = `if($wnd.__blobVirusGlowState){$wnd.__blobVirusGlowState.${drawCounter}=($wnd.__blobVirusGlowState.${drawCounter}+1)||1;$wnd.__blobVirusGlowState.lastGlowDrawSource='${sourceName}';$wnd.__blobVirusGlowState.${lastCell}={id:${cellName}.n,x:${cellName}.R,y:${cellName}.S,r:${cellName}.M,size:${cellName}.N,type:${cellName}.c?${cellName}.c.M:null,hasName:!!${cellName}.B,u:!!${cellName}.u,rflag:!!${cellName}.r,t:!!${cellName}.t,q:!!${cellName}.q}}`;
      if (!rotatedDrawName) {
        return `${markDraw}if($wnd.__blobVirusGlowState){$wnd.__blobVirusGlowState.${nonRotatedCounter}=($wnd.__blobVirusGlowState.${nonRotatedCounter}+1)||1}${normalDraw}`;
      }
      return `${markDraw}${rotatedDrawName}(${batchName},${textureName},${cellName}.R-${cellName}.M*2,${cellName}.S-${cellName}.M*2,${cellName}.N,${cellName}.N,${cellName}.N*2,${cellName}.N*2,1,1,$wnd.__blobVirusGlowGetDrawRotation?$wnd.__blobVirusGlowGetDrawRotation(${cellName}.n,${cellName}.R,${cellName}.S,'${sourceName}'):0)`;
    }

    function patchDrawRegionFunction(code, drawRegionName, rotatedDrawName) {
      const escapedName = escapeRegExp(drawRegionName);
      const drawFunction = new RegExp(`function ${escapedName}\\(a,b,c,d,e,f\\)\\{var g,h,i,j,k,l,m,n,o,p;`);
      if (!drawFunction.test(code)) {
        return { code, changed: false };
      }

      return {
        code: code.replace(drawFunction, (match) => match
          + 'g=$wnd.__blobVirusGlowState;'
          + (rotatedDrawName
            ? `if(g&&g.glowTexture&&b&&(b===g.glowTexture||b.v===g.glowTexture.v&&b.w===g.glowTexture.w&&b.C===g.glowTexture.C&&b.A===g.glowTexture.A&&b.B===g.glowTexture.B)){h=g.currentCell;g.glowTextureDraws=(g.glowTextureDraws+1)||1;if(h&&h.c&&(h.c.M==4||h.c.M==3||h.c.M==10)&&!h.B&&!h.u&&!h.r&&$wnd.__blobVirusGlowShouldRotate&&$wnd.__blobVirusGlowShouldRotate()){i=$wnd.__blobVirusGlowGetRotation(h.n,h.R,h.S);g.rotationDraws=(g.rotationDraws+1)||1;g.rotationGlowTextureDraws=(g.rotationGlowTextureDraws+1)||1;g.lastRotation=i;${rotatedDrawName}(a,b,c,d,e/2,f/2,e,f,1,1,i);return}}`
            : '')
          + 'if(g&&g.virusTexture&&(b===g.virusTexture||b.v===g.virusTexture.v&&b.w===g.virusTexture.w&&b.C===g.virusTexture.C&&b.A===g.virusTexture.A&&b.B===g.virusTexture.B)){'
          + 'h=g.currentCell;g.virusTextureDraws=(g.virusTextureDraws+1)||1;'
          + 'if(h&&g.glowTexture&&h.c&&(h.c.M==4||h.c.M==3)&&!h.B&&!h.u&&!h.r){'
          + 'g.viruses.push({id:h.n,x:h.R,y:h.S,r:h.M,size:h.N,mode:2,type:h.c.M});g.textureVirusHits=(g.textureVirusHits+1)||1;g.lastUpdate=(new Date).getTime();'
          + (rotatedDrawName
            ? `if($wnd.__blobVirusGlowShouldRotate&&$wnd.__blobVirusGlowShouldRotate()){i=$wnd.__blobVirusGlowGetRotation(h.n,h.R,h.S);g.rotationDraws=(g.rotationDraws+1)||1;g.rotationTextureDraws=(g.rotationTextureDraws+1)||1;g.lastRotation=i;${rotatedDrawName}(a,g.glowTexture,c-e/2,d-f/2,e,f,e*2,f*2,1,1,i);return}`
            : '')
          + 'b=g.glowTexture;c-=e/2;d-=f/2;e*=2;f*=2}else{g.skippedVirusTextureDraws=(g.skippedVirusTextureDraws+1)||1}}}'),
        changed: true,
      };
    }

    function findGlowTextureFromAsset(code) {
      const match = code.match(/[$A-Za-z_][$\w]*\.([$A-Za-z_][$\w]*)=[$A-Za-z_][$\w]*\([^;]*'_glow_mask'\)/);
      return match ? `a.${match[1]}` : null;
    }

    function findGlowTexture(code, startIndex, drawRegion) {
      const nextCase = code.slice(startIndex, startIndex + 700);
      const escapedDrawRegion = escapeRegExp(drawRegion);
      const glowCall = new RegExp(`${escapedDrawRegion}\\(a\\.c,(a\\.[$A-Za-z_][$\\w]*),g\\.R-g\\.M\\*2,g\\.S-g\\.M\\*2,g\\.N\\*2,g\\.N\\*2\\)`);
      return nextCase.match(glowCall)?.[1] || 'a.n';
    }

    function findRotatedDrawFunction(code) {
      return code.match(ROTATED_DRAW_RE)?.[1] || null;
    }

    function rememberRotatedDrawFunction(source) {
      if (typeof source !== 'string') {
        return null;
      }
      const name = findRotatedDrawFunction(source);
      if (name) {
        state.rotatedDrawName = name;
      }
      return name;
    }

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function shouldPatchScript(node) {
      return Boolean(node
        && node.tagName === 'SCRIPT'
        && node.src
        && !node.dataset.blobVirusGlowPatched
        && CACHE_SCRIPT_RE.test(node.src));
    }

    function rememberError(error) {
      const message = error?.message || String(error);
      state.errors.push(message);
      state.errors = state.errors.slice(-5);
      win.console?.warn?.('[Blobio Virus | Mother-cell]', message);
    }

    function patchDownloadedChunk(chunk) {
      if (typeof chunk !== 'string') {
        return chunk;
      }
      const patched = patchBundle(chunk);
      if (patched.changed) {
        state.patchedChunks += 1;
        return patched.code;
      }
      return chunk;
    }

    function patchDownloadedChunks(chunks) {
      if (Array.isArray(chunks)) {
        chunks.forEach(rememberRotatedDrawFunction);
        return chunks.map(patchDownloadedChunk);
      }
      return patchDownloadedChunk(chunks);
    }

    function installGwtCallbackPatch() {
      const html = win.html;
      if (!html || html.__blobVirusGlowWrapped || typeof html.onScriptDownloaded !== 'function') {
        return false;
      }
      const originalOnScriptDownloaded = html.onScriptDownloaded;
      html.onScriptDownloaded = function blobVirusGlowOnScriptDownloaded(chunks) {
        state.callbackCalls += 1;
        let patchedChunks = chunks;
        try {
          patchedChunks = patchDownloadedChunks(chunks);
        } catch (error) {
          rememberError(error);
        }
        return originalOnScriptDownloaded.call(this, patchedChunks);
      };
      html.__blobVirusGlowWrapped = true;
      state.wrappedCallback = true;
      return true;
    }

    NodeCtor.prototype.appendChild = function patchedAppendChild(node) {
      if (shouldPatchScript(node)) {
        state.seenCacheScripts += 1;
        installGwtCallbackPatch();
      }
      return nativeAppendChild.call(this, node);
    };

    NodeCtor.prototype.insertBefore = function patchedInsertBefore(node, beforeNode) {
      if (shouldPatchScript(node)) {
        state.seenCacheScripts += 1;
        installGwtCallbackPatch();
      }
      return nativeInsertBefore.call(this, node, beforeNode);
    };

    const callbackPatchTimer = win.setInterval(() => {
      if (installGwtCallbackPatch()) {
        win.clearInterval(callbackPatchTimer);
      }
    }, 10);
    win.setTimeout(() => win.clearInterval(callbackPatchTimer), 30000);
    return true;
  }
  /* VIRUS_RUNTIME_END */

  function getVirusResourceUrl(maskId) {
    const resourceNames = {
      halo: 'BLOBIO_VIRUS_HALO',
      rotate: 'BLOBIO_VIRUS_ROTATE',
      ring: 'BLOBIO_VIRUS_RING',
    };
    const fallbackUrls = {
      halo: 'https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/virus_glow_1%20_mask.png',
      rotate: 'https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/viurs_glow_2_random_rotate_mask.png',
      ring: 'https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Extension/main/assets/virus_glow_3%20_mask.png',
    };
    const normalizedMaskId = Object.hasOwn(resourceNames, maskId) ? maskId : 'halo';

    try {
      const resourceUrl = GM_getResourceURL?.(resourceNames[normalizedMaskId]);
      if (resourceUrl) {
        return resourceUrl;
      }
    } catch {}

    return fallbackUrls[normalizedMaskId];
  }

  function installVirusMotherCellRuntime() {
    if (location.hostname !== CUSTOM_CLIENT_HOST) {
      return;
    }

    try {
      if (getSharedValue(VIRUS_MOTHER_CELL_KEYS.enabled) !== '1') {
        return;
      }

      const rawMaskId = String(getSharedValue(VIRUS_MOTHER_CELL_KEYS.maskId) || 'halo').toLowerCase();
      const maskId = ['halo', 'rotate', 'ring'].includes(rawMaskId) ? rawMaskId : 'halo';
      const rawColor = String(getSharedValue(VIRUS_MOTHER_CELL_KEYS.color) || '#ff0000').toLowerCase();
      const color = /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : '#ff0000';
      const rawAlpha = Number(getSharedValue(VIRUS_MOTHER_CELL_KEYS.alpha));
      const alpha = Number.isFinite(rawAlpha) ? Math.max(0, Math.min(1, rawAlpha)) : 0.85;
      const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : globalThis;

      pageVirusMotherCellBootstrap({
        enabled: true,
        maskId,
        maskUrl: getVirusResourceUrl(maskId),
        color,
        alpha,
        rotate: getSharedValue(VIRUS_MOTHER_CELL_KEYS.rotate) === '1',
        version: VERSION,
      }, pageWindow);
    } catch (error) {
      logError('Failed to install Virus | Mother-cell runtime.', error);
    }
  }

  function installFpsUncapRuntime() {
    if (location.hostname !== CUSTOM_CLIENT_HOST) {
      return;
    }

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const readEnabled = () => getSharedValue(FPS_UNCAP_STORAGE_KEY) === '1';

    try {
      pageFpsUncapBootstrap(readEnabled(), pageWindow);
    } catch (error) {
      logError('Failed to install FPS-uncap runtime.', error);
      return;
    }

    const refresh = () => {
      try {
        pageWindow.__blobioFpsUncapRefresh?.(readEnabled());
      } catch (error) {
        logError('Failed to refresh FPS-uncap state.', error);
      }
    };

    if (typeof GM_addValueChangeListener === 'function') {
      try {
        GM_addValueChangeListener(FPS_UNCAP_STORAGE_KEY, refresh);
      } catch {}
    }

    window.addEventListener?.('message', (event) => {
      const message = event.data;
      if (message?.source === STORAGE_BRIDGE_SOURCE && message.key === FPS_UNCAP_STORAGE_KEY) {
        refresh();
      }
    });
  }

  function runBundle(source) {
    try {
      const run = new Function(`${source}\n//# sourceURL=blobio-extension.bundle.js`);
      run();
    } catch (error) {
      logError('Failed to run extension bundle.', error);
    }
  }

  function fetchBundle(index = 0, failures = []) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      logError('GM_xmlhttpRequest is unavailable. Check the userscript grants.');
      return;
    }

    const url = BUNDLE_URLS[index];
    if (!url) {
      logError('Failed to fetch extension bundle from all configured URLs.', failures);
      return;
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 15000,
      onload(response) {
        if (response.status < 200 || response.status >= 300 || !response.responseText) {
          fetchBundle(index + 1, failures.concat(`Invalid response from ${url}`));
          return;
        }
        runBundle(response.responseText);
      },
      onerror(error) {
        fetchBundle(index + 1, failures.concat(error || `Network error from ${url}`));
      },
      ontimeout() {
        fetchBundle(index + 1, failures.concat(`Timed out while fetching ${url}`));
      },
    });
  }

  installExtensionInputKeyboardIsolation();
  installEarlyKeyboardRuntime();
  installSharedStorageBridge();
  installVirusMotherCellRuntime();
  installFpsUncapRuntime();
  installCarrierSkinRuntime();
  fetchBundle();
})();
