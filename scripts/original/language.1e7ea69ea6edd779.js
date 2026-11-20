(() => {
  'use strict';
  const STORAGE_KEY = 'm3u8play.language.v1';

  function matchLanguage(preferences, supported, fallback = 'en') {
    const codes = new Map(supported.map(code => [code.toLowerCase(), code]));
    for (const preference of preferences) {
      if (typeof preference !== 'string') continue;
      const tag = preference.toLowerCase().replace(/_/g, '-');
      if (codes.has(tag)) return codes.get(tag);
      const parts = tag.split('-');
      if (parts[0] === 'zh') {
        const traditional = parts.includes('hant') || (!parts.includes('hans') && parts.some(p => ['tw', 'hk', 'mo'].includes(p)));
        const code = traditional ? 'zh-tw' : 'zh-cn';
        if (codes.has(code)) return codes.get(code);
      }
      if (codes.has(parts[0])) return codes.get(parts[0]);
    }
    return fallback;
  }

  const PLAYBACK_KEYS = Object.freeze(['url', 'title', 'type', 'autoplay', 'muted', 'volume', 'rate', 'start', 'loop', 'poster', 'subtitle', 'lang', 'history', 'resume', 'theater', 'lights', 'quality', 'audio', 'aspect']);

  function playbackTime(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const text = String(value).trim();
    if (!/^(?:\d+(?:\.\d+)?|\d+(?::[0-5]\d){1,2}(?:\.\d+)?)$/.test(text)) return null;
    const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    return Number.isFinite(seconds) && seconds <= 31536000 ? seconds : null;
  }

  function playbackOptions(parameters, protocol = 'https:') {
    const boolean = (name, fallback = null) => {
      const value = parameters.get(name)?.toLowerCase();
      return ['1', 'true'].includes(value) ? true : ['0', 'false'].includes(value) ? false : fallback;
    };
    const number = (name, min, max, integer = false) => {
      const raw = parameters.get(name);
      if (!raw || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : null;
    };
    const resource = name => {
      try {
        const value = parameters.get(name) || '';
        if (value.length > 16384) return '';
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (protocol === 'https:' && url.protocol !== 'https:')) return '';
        return url.href;
      } catch (_) { return ''; }
    };
    const quality = parameters.get('quality') || '';
    return {
      url: parameters.get('url') || '', title: (parameters.get('title') || '').slice(0, 120),
      type: ['hls', 'video'].includes(parameters.get('type')) ? parameters.get('type') : 'auto',
      autoplay: boolean('autoplay', true), muted: boolean('muted', false),
      volume: number('volume', 0, 1), rate: number('rate', .25, 4), start: playbackTime(parameters.get('start')),
      loop: boolean('loop'), poster: resource('poster'), subtitle: resource('subtitle'),
      lang: (parameters.get('lang') || '').slice(0, 35), history: boolean('history'), resume: boolean('resume', true),
      theater: boolean('theater', false), lights: boolean('lights', false), quality: /^\d{2,4}p?$/.test(quality) && Number(quality.replace('p', '')) <= 8640 ? Number(quality.replace('p', '')) : null,
      audio: number('audio', 0, 63, true), aspect: ['16:9', '4:3', '1:1'].includes(parameters.get('aspect')) ? parameters.get('aspect') : 'auto',
    };
  }

  function playbackParameters(source, compact = false) {
    const parameters = new URLSearchParams();
    const defaults = {type: 'auto', autoplay: true, muted: false, resume: true, theater: false, lights: false, aspect: 'auto'};
    for (const key of PLAYBACK_KEYS) {
      const value = source[key];
      if (value === null || value === undefined || (value === '' && key !== 'url') || (compact && defaults[key] === value)) continue;
      parameters.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    return parameters;
  }

  function buildPlaybackUrl(base, source) {
    const page = new URL(base);
    if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password || !source.url) throw new TypeError('A player URL and video URL are required.');
    page.search = ''; page.hash = '';
    const parameters = playbackParameters(source, true).toString();
    page.hash = parameters;
    return page.href;
  }

  function selectQuality(levels, height) {
    if (!height) return -1;
    const options = levels.map((level, index) => ({height: level.height, bitrate: level.bitrate || 0, index})).filter(level => level.height > 0);
    if (!options.length) return -1;
    const lower = options.filter(level => level.height <= height).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
    return (lower[0] || options.sort((a, b) => a.height - b.height || a.bitrate - b.bitrate)[0]).index;
  }

  // Decode one outer layer only. Media signatures are not decoded a second time.
  function playbackLink(href) {
    const page = new URL(href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    if (!fragment.has('url')) return null;
    const parameters = fragment;
    const source = playbackOptions(parameters, page.protocol);
    const clean = raw => raw.split('&').filter(part => {
      const entry = new URLSearchParams(part);
      return !PLAYBACK_KEYS.some(key => entry.has(key));
    }).join('&');
    const query = page.search.slice(1), hash = clean(page.hash.slice(1));
    return {source, cleanPath: page.pathname + (query ? '?' + query : '') + (hash ? '#' + hash : ''),
      redirectSuffix: (query ? '?' + query : '') + '#' + (hash ? hash + '&' : '') + playbackParameters(source)};
  }


  if (typeof module === 'object' && module.exports) module.exports = {matchLanguage, playbackLink, playbackOptions, playbackTime, buildPlaybackUrl, selectQuality, PLAYBACK_KEYS, STORAGE_KEY};
  if (typeof window === 'undefined') return;
  window.PlayerLinks = Object.freeze({build: buildPlaybackUrl, selectQuality, time: playbackTime});
  const element = document.getElementById('language-config');
  if (!element) return;
  const config = JSON.parse(element.textContent);
  const languages = new Map(config.languages.map(language => [language.code, language]));
  const launch = config.suffix === '' ? playbackLink(location.href) : null;
  if (launch) {
    window.PlayerLaunch = launch.source;
    // Consume fragment playback options before GTM; leave the query string untouched.
    try { history.replaceState(history.state, '', launch.cleanPath); } catch (_) { /* Playback remains usable. */ }
  }

  function readPreference() {
    for (const name of ['localStorage', 'sessionStorage']) {
      try {
        const code = window[name].getItem(STORAGE_KEY);
        if (languages.has(code)) return code;
      } catch (_) { /* Language selection also works when storage is unavailable. */ }
    }
    return null;
  }

  function remember(code) {
    for (const name of ['localStorage', 'sessionStorage']) {
      try { window[name].setItem(STORAGE_KEY, code); } catch (_) { /* Optional preference storage. */ }
    }
  }

  // Explicit selections carry a fragment so English still works with blocked storage/new tabs.
  // Remove only our own marker, preserving unrelated fragments and all query parameters.
  const marker = /^#language=([a-zA-Z-]+)$/.exec(location.hash);
  const explicit = marker && marker[1] === config.locale;
  if (explicit) {
    remember(config.locale);
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* Optional URL cleanup. */ }
  }
  const defaultLanguage = languages.get(config.defaultLocale);
  const landingPath = defaultLanguage.path + config.suffix;
  const requested = launch?.source.lang ? matchLanguage([launch.source.lang], [...languages.keys()], null) : null;
  const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
  const selected = requested || (location.pathname === landingPath && !explicit
    ? readPreference() || matchLanguage(preferences, [...languages.keys()], config.defaultLocale)
    : config.locale);
  if (selected !== config.locale) {
    location.replace(languages.get(selected).path + config.suffix + (launch ? launch.redirectSuffix : location.search + location.hash));
    return;
  }

  if (config.suffix === '') window.addEventListener('hashchange', () => {
    const request = playbackLink(location.href);
    if (!request) return;
    try { history.replaceState(history.state, '', request.cleanPath); } catch (_) { /* Optional address cleanup. */ }
    const requested = request.source.lang ? matchLanguage([request.source.lang], [...languages.keys()], null) : null;
    if (requested && requested !== config.locale) {
      location.replace(languages.get(requested).path + request.redirectSuffix);
      return;
    }
    window.PlayerLaunch = request.source;
    window.dispatchEvent(new Event('player:launch'));
  });

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    const languageLink = link.matches('.language-options a[hreflang]');
    const code = languageLink ? link.getAttribute('hreflang') : config.locale;
    if (!languages.has(code)) return;
    const url = new URL(link.href, location.href);
    const ownNavigation = link.closest('.primary-nav, .brand, .guide-player-link') || link.matches('[data-player-guide]');
    if (!languageLink && !ownNavigation) return;
    if (url.origin !== location.origin) return;
    if (languageLink) remember(code);
    if (code === config.defaultLocale && [defaultLanguage.path, defaultLanguage.path + 'download/', defaultLanguage.path + 'player-integration/'].includes(url.pathname)) {
      url.hash = 'language=' + code;
      link.href = url.href;
    }
  });
})();
