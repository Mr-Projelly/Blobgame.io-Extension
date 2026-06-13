// ==UserScript==
// @name         Blobio Web Script Loader
// @namespace    https://github.com/SkyViewBlobio/Blobgame.io-Web-Script
// @version      0.1.39
// @description  Loads the Blobio modular extension bundle from GitHub.
// @match        *://blobgame.io/*
// @match        *://custom.client.blobgame.io/*
// @run-at       document-start
// @sandbox      JavaScript
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @connect      i.imgur.com
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Web-Script/main/loader/blobio-loader.user.js
// @updateURL    https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Web-Script/main/loader/blobio-loader.user.js
// ==/UserScript==

(() => {
  'use strict';

  const LOG_PREFIX = '[Blobio]';
  const VERSION = '0.1.39';
  const CUSTOM_CLIENT_HOST = 'custom.client.blobgame.io';
  const STORAGE_BRIDGE_SOURCE = 'BlobioExtensionStorageBridge';
  const CUSTOM_SKIN_ENABLED_KEY = 'blobio.customSkin.enabled';
  const CUSTOM_SKIN_ACTIVE_KEY = 'blobio.customSkin.activeUrl';
  const CUSTOM_SKIN_CARRIER_ASSET_KEY = 'blobio.customSkin.carrierAsset';
  const DIRECT_IMGUR_IMAGE_MATCH = /^https:\/\/i\.imgur\.com\/[a-z0-9]+\.(?:png|jpe?g|webp)(?:\?.*)?$/i;
  const BUNDLE_URLS = [
    `https://raw.githubusercontent.com/SkyViewBlobio/Blobgame.io-Web-Script/main/dist/blobio-extension.bundle.js?v=${VERSION}`,
    `https://cdn.jsdelivr.net/gh/SkyViewBlobio/Blobgame.io-Web-Script@main/dist/blobio-extension.bundle.js?v=${VERSION}`,
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

  function isCustomSkinStorageKey(key) {
    return String(key || '').startsWith('blobio.customSkin.');
  }

  function installSharedStorageBridge() {
    if (globalThis.__blobioSharedStorageBridgeInstalled) {
      return;
    }

    globalThis.__blobioSharedStorageBridge = {
      getItem(key) {
        return isCustomSkinStorageKey(key) ? getSharedValue(key) : getLocalValue(key);
      },
      setItem(key, value) {
        if (isCustomSkinStorageKey(key)) {
          setSharedValue(key, value);
        } else {
          setLocalValue(key, value);
        }
      },
      removeItem(key) {
        if (isCustomSkinStorageKey(key)) {
          removeSharedValue(key);
        } else {
          removeLocalValue(key);
        }
      },
    };

    window.addEventListener?.('message', (event) => {
      const message = event.data;
      if (!message || message.source !== STORAGE_BRIDGE_SOURCE || !isCustomSkinStorageKey(message.key)) {
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

    return { enabled, activeUrl: enabled ? activeUrl : '', carrierAsset: enabled ? carrierAsset : '' };
  }

  function pageCarrierSkinBootstrap(initialState, pageWindow) {
    'use strict';

    const window = pageWindow || globalThis;
    const document = window.document;
    const ImageElement = window.HTMLImageElement;
    const Element = window.Element;
    const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    const nativeImageSrc = ImageElement
      ? Object.getOwnPropertyDescriptor(ImageElement.prototype, 'src')
      : null;
    const nativeSetAttribute = Element?.prototype?.setAttribute;

    if (window.__blobioCarrierSkinInstalled) {
      window.__blobioCarrierSkinRefresh?.(initialState);
      return;
    }

    let state = { enabled: false, activeUrl: '', carrierAsset: '', ...initialState };
    let replacementUrl = '';
    let replacementFailed = false;
    let waiters = [];
    const pendingImages = new Map();
    const status = {
      imageRequests: 0,
      fetchRequests: 0,
      replacements: 0,
      queuedImages: 0,
      lastCarrierRequest: '',
      lastError: '',
    };

    function getPath(rawUrl) {
      try {
        return new URL(String(rawUrl || ''), window.location.href).pathname;
      } catch {
        return '';
      }
    }

    function matchesCarrier(rawUrl) {
      return Boolean(state.enabled && state.carrierAsset && getPath(rawUrl) === getPath(state.carrierAsset));
    }

    function settleWaiters(value) {
      const current = waiters;
      waiters = [];
      for (const resolve of current) {
        resolve(value);
      }
    }

    function waitForReplacement() {
      if (replacementUrl || replacementFailed || !state.enabled) {
        return Promise.resolve(replacementUrl);
      }

      return new Promise((resolve) => waiters.push(resolve));
    }

    function setNativeImageSource(image, url) {
      if (nativeImageSrc?.set) {
        nativeImageSrc.set.call(image, url);
      } else if (nativeSetAttribute) {
        nativeSetAttribute.call(image, 'src', url);
      }
    }

    function flushPendingImages(useReplacement) {
      for (const [image, originalUrl] of pendingImages) {
        setNativeImageSource(image, useReplacement && replacementUrl ? replacementUrl : originalUrl);
        if (useReplacement && replacementUrl) {
          status.replacements += 1;
        }
      }
      pendingImages.clear();
      status.queuedImages = 0;
    }

    function handleImageSource(image, rawUrl) {
      if (!matchesCarrier(rawUrl)) {
        return false;
      }

      const originalUrl = String(rawUrl);
      status.imageRequests += 1;
      status.lastCarrierRequest = originalUrl;

      if (replacementUrl) {
        setNativeImageSource(image, replacementUrl);
        status.replacements += 1;
      } else if (replacementFailed) {
        setNativeImageSource(image, originalUrl);
      } else {
        pendingImages.set(image, originalUrl);
        status.queuedImages = pendingImages.size;
      }

      return true;
    }

    if (nativeImageSrc?.get && nativeImageSrc?.set) {
      Object.defineProperty(ImageElement.prototype, 'src', {
        configurable: nativeImageSrc.configurable,
        enumerable: nativeImageSrc.enumerable,
        get: nativeImageSrc.get,
        set(value) {
          if (!handleImageSource(this, value)) {
            nativeImageSrc.set.call(this, value);
          }
        },
      });
    }

    if (nativeSetAttribute) {
      Element.prototype.setAttribute = function setBlobioCarrierAttribute(name, value) {
        if (this instanceof ImageElement && String(name).toLowerCase() === 'src' && handleImageSource(this, value)) {
          return;
        }
        return nativeSetAttribute.call(this, name, value);
      };
    }

    if (nativeFetch) {
      window.fetch = async function fetchBlobioCarrier(input, init) {
        const rawUrl = typeof input === 'string' || input instanceof window.URL ? String(input) : input?.url || '';
        if (!matchesCarrier(rawUrl)) {
          return nativeFetch(input, init);
        }

        status.fetchRequests += 1;
        status.lastCarrierRequest = rawUrl;
        const resolved = await waitForReplacement();
        if (!resolved) {
          return nativeFetch(input, init);
        }

        status.replacements += 1;
        return nativeFetch(resolved, init);
      };
    }

    function refresh(nextState) {
      const previousKey = `${state.activeUrl}|${state.carrierAsset}`;
      state = { enabled: false, activeUrl: '', carrierAsset: '', ...nextState };
      const nextKey = `${state.activeUrl}|${state.carrierAsset}`;

      if (!state.enabled) {
        replacementUrl = '';
        replacementFailed = false;
        flushPendingImages(false);
        settleWaiters('');
        return;
      }

      if (previousKey !== nextKey) {
        replacementUrl = '';
        replacementFailed = false;
        flushPendingImages(false);
        settleWaiters('');
      }
    }

    function setReplacement(url, activeUrl) {
      if (!state.enabled || (activeUrl && activeUrl !== state.activeUrl)) {
        return false;
      }

      replacementUrl = String(url || '');
      replacementFailed = !replacementUrl;
      flushPendingImages(Boolean(replacementUrl));
      settleWaiters(replacementUrl);
      return Boolean(replacementUrl);
    }

    function failReplacement(message, activeUrl) {
      if (activeUrl && activeUrl !== state.activeUrl) {
        return;
      }

      replacementUrl = '';
      replacementFailed = true;
      status.lastError = String(message || 'Custom skin image preparation failed.');
      flushPendingImages(false);
      settleWaiters('');
    }

    window.__blobioCarrierSkinRefresh = refresh;
    window.__blobioCarrierSkinSetReplacement = setReplacement;
    window.__blobioCarrierSkinFail = failReplacement;
    window.__blobioCarrierSkinStatus = () => ({
      ...status,
      enabled: state.enabled,
      activeUrl: state.activeUrl,
      carrierAsset: state.carrierAsset,
      replacementReady: Boolean(replacementUrl),
    });
    window.__blobioCarrierSkinInstalled = true;

    for (const image of document?.querySelectorAll?.('img[src]') || []) {
      const current = nativeImageSrc?.get?.call(image) || image.getAttribute?.('src') || '';
      if (matchesCarrier(current)) {
        handleImageSource(image, current);
      }
    }
  }

  function requestImageBlob(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is unavailable.'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        timeout: 15000,
        onload(response) {
          if (response.status < 200 || response.status >= 300 || !response.response) {
            reject(new Error(`Custom skin image returned HTTP ${response.status}.`));
            return;
          }
          resolve(response.response);
        },
        onerror() {
          reject(new Error('Custom skin image could not be downloaded.'));
        },
        ontimeout() {
          reject(new Error('Custom skin image download timed out.'));
        },
      });
    });
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Custom skin image could not be decoded.'));
      };
      image.src = objectUrl;
    });
  }

  async function prepareCustomSkinDataUrl(url) {
    const blob = await requestImageBlob(url);
    const image = await loadImageFromBlob(blob);
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Canvas 2D is unavailable.');
    }

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const sourceSize = Math.min(sourceWidth, sourceHeight);
    const sourceX = (sourceWidth - sourceSize) / 2;
    const sourceY = (sourceHeight - sourceSize) / 2;

    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  }

  function installCarrierSkinRuntime() {
    if (location.host !== CUSTOM_CLIENT_HOST) {
      return;
    }

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let generation = 0;

    try {
      pageCarrierSkinBootstrap(getCustomSkinState(), pageWindow);
    } catch (error) {
      logError('Failed to install the owned-skin asset replacement.', error);
      return;
    }

    async function refresh() {
      const state = getCustomSkinState();
      pageWindow.__blobioCarrierSkinRefresh?.(state);
      const currentGeneration = ++generation;

      if (!state.enabled) {
        return;
      }

      try {
        const dataUrl = await prepareCustomSkinDataUrl(state.activeUrl);
        if (currentGeneration !== generation) {
          return;
        }
        pageWindow.__blobioCarrierSkinSetReplacement?.(dataUrl, state.activeUrl);
      } catch (error) {
        if (currentGeneration !== generation) {
          return;
        }
        pageWindow.__blobioCarrierSkinFail?.(error?.message || String(error), state.activeUrl);
        logError('Custom Skin image preparation failed. The original owned skin will be used.', error);
      }
    }

    refresh();

    if (typeof GM_addValueChangeListener === 'function') {
      for (const key of [CUSTOM_SKIN_ENABLED_KEY, CUSTOM_SKIN_ACTIVE_KEY, CUSTOM_SKIN_CARRIER_ASSET_KEY]) {
        try {
          GM_addValueChangeListener(key, refresh);
        } catch {}
      }
    }

    window.addEventListener?.('message', (event) => {
      const message = event.data;
      if (message?.source === STORAGE_BRIDGE_SOURCE && [CUSTOM_SKIN_ENABLED_KEY, CUSTOM_SKIN_ACTIVE_KEY, CUSTOM_SKIN_CARRIER_ASSET_KEY].includes(message.key)) {
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

  installSharedStorageBridge();
  installCarrierSkinRuntime();
  fetchBundle();
})();
