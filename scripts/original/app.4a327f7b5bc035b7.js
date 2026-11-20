(() => {
  'use strict';
  const C = window.PlayerCore;
  const { t, locale, playerMessages } = window.PlayerI18n;
  const $ = id => document.getElementById(id);
  const icon = (name, style = 'solid') => `<i class="icon fa-${style} fa-${name}" aria-hidden="true"></i>`;
  // Use ArtPlayer's public icon API; all artwork comes from Font Awesome.
  const playerIcons = Object.fromEntries(Object.entries({
    loading: 'spinner fa-spin', state: 'play', play: 'play', pause: 'pause', check: 'check',
    volume: 'volume-high', volumeClose: 'volume-xmark', screenshot: 'camera', setting: 'gear',
    pip: 'clone', arrowLeft: 'chevron-left', arrowRight: 'chevron-right', playbackRate: 'gauge-high',
    aspectRatio: 'up-right-and-down-left-from-center', config: 'sliders', lock: 'lock',
    flip: 'right-left', unlock: 'lock-open', fullscreenOff: 'compress', fullscreenOn: 'expand',
    fullscreenWebOff: 'down-left-and-up-right-to-center', fullscreenWebOn: 'maximize',
    switchOn: 'toggle-on', switchOff: 'toggle-off', error: 'circle-exclamation', close: 'xmark', airplay: 'tv'
  }).map(([key, name]) => [key, icon(name)]));
  let storageFailed = false, toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { if (!storageFailed) toast(t('storageUnavailable')); storageFailed = true; return false; }
  }
  const rawPrefs = read(C.PREFS_KEY, {});
  const prefs = { remember: rawPrefs?.remember !== false, loop: rawPrefs?.loop === true, volume: typeof rawPrefs?.volume === 'number' ? Math.min(1, Math.max(0, rawPrefs.volume)) : .7, rate: typeof rawPrefs?.rate === 'number' && Number.isFinite(rawPrefs.rate) && rawPrefs.rate >= .25 && rawPrefs.rate <= 4 ? rawPrefs.rate : 1 };
  let history = C.cleanHistory(read(C.HISTORY_KEY, []));
  let art = null, hls = null, active = null, session = 0, timer, recoveryTimer, watchdog, lastSave = 0, subtitleUrl, trackElement;
  let filter = 'all', localUrl, nativeHls = false, prefilledSource = false, launchOptions = null, subtitleRequest = null, lightsInert = [];
  const DEMO = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  const Q = window.PlayerQueueCore;
  let playlist = Q.clean(read(Q.KEY, []), location.protocol);
  let queueAuto = read(Q.OPTIONS_KEY, {})?.auto !== false;
  function playlistIndex() { return active && !active.local ? playlist.findIndex(row => row.url === active.url) : -1; }
  function renderPlaylist() {
    const index = playlistIndex(), list = $('playlist-list');
    $('playlist-count').textContent = playlist.length; $('playlist-count').hidden = !playlist.length;
    $('playlist-content').hidden = !playlist.length;
    $('playlist-prev').disabled = index <= 0; $('playlist-next').disabled = index < 0 || index >= playlist.length - 1;
    $('playlist-auto').checked = queueAuto;
    const fragment = document.createDocumentFragment();
    playlist.forEach((row, i) => {
      const item = document.createElement('li'); item.className = 'playlist-item';
      const open = document.createElement('button'); open.className = 'playlist-open'; open.title = row.title;
      open.setAttribute('aria-label', t('playItem', {title: row.title}));
      if (i === index) open.setAttribute('aria-current', 'true');
      const number = document.createElement('span'); number.className = 'playlist-number'; number.textContent = i + 1;
      const info = document.createElement('span'); info.className = 'playlist-info';
      const title = document.createElement('strong'), host = document.createElement('small');
      title.textContent = row.title; host.textContent = C.sourceHost(row.url); info.append(title, host); open.append(number, info);
      open.onclick = () => playQueue(i);
      const remove = buttonIcon('trash-can', t('removeItem', {title: row.title}), () => { playlist = playlist.filter(entry => entry.url !== row.url); write(Q.KEY, playlist); renderPlaylist(); });
      item.append(open, remove); fragment.append(item);
    });
    list.replaceChildren(fragment);
  }
  function playQueue(index) {
    const source = playlist[index]; if (!source) return;
    prefilledSource = true; launchOptions = null; selectSourceTab(false);
    $('source-url').value = source.url; $('source-title').value = source.title; $('source-type').value = source.type;
    loadOnline(source.url, source.title, source.type, {resume: false, autoplay: true});
  }
  $('playlist-add').onclick = () => { $('playlist-error').hidden = true; $('playlist-input').setAttribute('aria-invalid', 'false'); $('playlist-dialog').showModal(); };
  $('playlist-form').onsubmit = event => {
    event.preventDefault();
    const result = Q.parseBatch($('playlist-input').value, playlist, location.protocol);
    if (result.error) {
      $('playlist-error').textContent = t(result.error, {line: result.line}) + (result.reason ? ' ' + t(result.reason) : '');
      $('playlist-error').hidden = false; $('playlist-input').setAttribute('aria-invalid', 'true'); $('playlist-input').focus(); return;
    }
    playlist = result.items; write(Q.KEY, playlist); renderPlaylist(); $('playlist-input').value = ''; $('playlist-dialog').close();
    toast(t('queueAdded', result));
  };
  $('playlist-prev').onclick = () => playQueue(playlistIndex() - 1);
  $('playlist-next').onclick = () => { const index = playlistIndex(); if (index >= 0) playQueue(index + 1); };
  $('playlist-auto').onchange = () => { queueAuto = $('playlist-auto').checked; write(Q.OPTIONS_KEY, {auto: queueAuto}); };
  $('playlist-clear').onclick = () => $('playlist-clear-dialog').showModal();
  $('playlist-confirm-clear').onclick = () => { playlist = []; write(Q.KEY, playlist); renderPlaylist(); $('playlist-clear-dialog').close(); };
  renderPlaylist();

  const B = window.PlayerHistoryBackup;
  let pendingBackup = null, backupRead = 0;
  function resetBackup() {
    pendingBackup = null; $('backup-preview').hidden = true; $('backup-error').hidden = true; $('backup-confirm-row').hidden = true;
    $('backup-confirm').disabled = true; $('backup-file-name').textContent = '';
  }
  $('history-backup').onclick = () => { saveProgress(true); resetBackup(); $('backup-export').disabled = !history.length; $('backup-dialog').showModal(); $('backup-dialog').querySelector('.settings-scroll').scrollTop = 0; };
  $('backup-export').onclick = () => {
    saveProgress(true); if (!history.length) return;
    try {
      const blob = new Blob([JSON.stringify(B.create(history), null, 2) + '\n'], {type: 'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob), link = document.createElement('a'), date = new Date();
      const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
      link.href = url; link.download = 'm3u8-player-history-' + day + '.json'; document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      toast(t('backupExported'));
    } catch (_) { $('backup-error').textContent = t('historyExportError'); $('backup-error').hidden = false; }
  };
  $('backup-import').onclick = () => $('backup-file').click();
  $('backup-file').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    const id = ++backupRead; resetBackup(); $('backup-import').disabled = true;
    try {
      if (file.size > B.MAX_BYTES) throw {code: 'backupTooLarge'};
      const text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
      const rows = B.parse(text); if (id !== backupRead || !$('backup-dialog').open) return;
      pendingBackup = rows; $('backup-file-name').textContent = file.name;
      $('backup-summary').textContent = t('backupSummary', B.summary(history, rows));
      $('backup-preview').hidden = false; $('backup-confirm-row').hidden = false; $('backup-confirm').disabled = !rows.length;
      $('backup-preview').scrollIntoView({block: 'nearest'});
    } catch (error) {
      if (id !== backupRead || !$('backup-dialog').open) return;
      $('backup-error').textContent = t(error.code || 'backupInvalid'); $('backup-error').hidden = false;
      $('backup-error').scrollIntoView({block: 'nearest'});
    } finally { if (id === backupRead) $('backup-import').disabled = false; }
  };
  $('backup-confirm').onclick = () => {
    if (!pendingBackup) return;
    saveProgress(true); const merged = B.merge(history, pendingBackup);
    if (!write(C.HISTORY_KEY, merged)) { $('backup-error').textContent = t('backupSaveError'); $('backup-error').hidden = false; $('backup-error').scrollIntoView({block: 'nearest'}); return; }
    history = merged; renderHistory(); $('backup-dialog').close(); toast(t('backupDone'));
  };
  $('backup-dialog').addEventListener('close', () => { backupRead++; resetBackup(); $('backup-import').disabled = false; });

  const Caption = window.PlayerCaptions;
  let captions = null, captionStyle = Caption.cleanStyle(read(Caption.KEY, {}));
  function updateCaptionPreview() {
    $('caption-size').value = captionStyle.size; $('caption-background').value = captionStyle.background;
    $('caption-preview').dataset.captionSize = captionStyle.size; $('caption-preview').dataset.captionBackground = captionStyle.background;
  }
  function updateCaptionSelection() {
    const selected = $('subtitle-select').value !== 'off';
    $('caption-delay').disabled = !selected; $('caption-earlier').disabled = !selected; $('caption-later').disabled = !selected;
    $('caption-off-note').hidden = selected; captions?.sync();
  }
  function setCaptionDelay(value) {
    if (!captions || !Number.isFinite(value)) return;
    $('caption-delay').value = captions.setDelay(value);
  }
  $('subtitle-settings').onclick = () => { updateCaptionPreview(); updateCaptionSelection(); $('caption-delay').value = captions?.getDelay() || 0; $('caption-dialog').showModal(); $('caption-dialog').querySelector('.settings-scroll').scrollTop = 0; };
  $('caption-delay').oninput = () => { const input = $('caption-delay'); if (input.value !== '' && input.validity.valid) setCaptionDelay(input.valueAsNumber); };
  $('caption-delay').onchange = () => { $('caption-delay').value = captions?.getDelay() || 0; };
  $('caption-earlier').onclick = () => setCaptionDelay((captions?.getDelay() || 0) - .5);
  $('caption-later').onclick = () => setCaptionDelay((captions?.getDelay() || 0) + .5);
  function saveCaptionStyle() { captionStyle = Caption.cleanStyle({size: $('caption-size').value, background: $('caption-background').value}); captions?.applyStyle(captionStyle); write(Caption.KEY, captionStyle); updateCaptionPreview(); }
  $('caption-size').onchange = saveCaptionStyle; $('caption-background').onchange = saveCaptionStyle;
  $('caption-reset').onclick = () => { captionStyle = Caption.cleanStyle({}); captions?.applyStyle(captionStyle); setCaptionDelay(0); write(Caption.KEY, captionStyle); updateCaptionPreview(); };
  updateCaptionPreview();

  function savePrefs() { write(C.PREFS_KEY, prefs); }
  function persistHistory(render = true) { write(C.HISTORY_KEY, history); if (render) renderHistory(); }
  function setStatus(text, state = '') { $('play-status').textContent = text; $('status-dot').className = `status-dot ${state}`; }
  function message(text, error = false) { $('source-message').textContent = text; $('source-message').classList.toggle('error', error); $('source-message').hidden = !error; $('source-url').setAttribute('aria-invalid', String(error)); }
  function selectSourceTab(local) {
    ['url', 'local'].forEach(name => { const selected = (name === 'local') === local; $(name + '-tab').classList.toggle('active', selected); $(name + '-tab').setAttribute('aria-selected', String(selected)); $(name + '-tab').tabIndex = selected ? 0 : -1; $(name + '-pane').hidden = !selected; });
  }
  function selectFilter(value) {
    filter = value;
    ['all', 'favorites'].forEach(name => { const selected = name === value; $(name + '-tab').classList.toggle('active', selected); $(name + '-tab').setAttribute('aria-selected', String(selected)); $(name + '-tab').tabIndex = selected ? 0 : -1; });
    $('history-list').setAttribute('aria-labelledby', value + '-tab'); renderHistory();
  }
  function tabsKeyboard(ids) { ids.forEach((id, index) => $(id).addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) * (document.documentElement.dir === 'rtl' ? -1 : 1) + ids.length) % ids.length; $(ids[next]).click(); $(ids[next]).focus(); })); }
  function buttonIcon(name, label, callback) { const button = document.createElement('button'); button.className = 'icon-button'; button.innerHTML = icon(name, ['star', 'trash-can'].includes(name) ? 'regular' : 'solid'); button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', callback); return button; }
  function toggleFavorite(url) { const item = history.find(row => row.url === url); if (!item) return; item.favorite = !item.favorite; persistHistory(); updateFavorite(); }
  function updateFavorite() { const row = active && history.find(item => item.url === active.url); $('favorite-current').disabled = !row; $('favorite-current').setAttribute('aria-pressed', String(row?.favorite === true)); $('favorite-current').setAttribute('aria-label', row?.favorite ? t('unfavoriteCurrent') : t('favoriteCurrent')); $('favorite-current').title = $('favorite-current').getAttribute('aria-label'); }
  function renderHistory() {
    if (!history.length) {
      $('history-search').value = ''; filter = 'all';
      ['all', 'favorites'].forEach(name => { const selected = name === 'all'; $(name + '-tab').classList.toggle('active', selected); $(name + '-tab').setAttribute('aria-selected', String(selected)); $(name + '-tab').tabIndex = selected ? 0 : -1; });
    }
    const search = $('history-search').value.trim().toLocaleLowerCase();
    const rows = history.filter(row => (filter !== 'favorites' || row.favorite) && `${row.title} ${C.sourceHost(row.url)}`.toLocaleLowerCase().includes(search));
    const isEmpty = history.length === 0;
    $('history-panel').classList.toggle('is-empty', isEmpty);
    $('history-count').hidden = isEmpty; $('clear-history').hidden = isEmpty;
    $('export-history').hidden = isEmpty; $('export-history').disabled = isEmpty;
    document.querySelector('.history-tabs').hidden = isEmpty;
    document.querySelector('.history-search').hidden = isEmpty;
    $('history-list').setAttribute('aria-labelledby', isEmpty ? 'history-heading' : filter + '-tab');
    $('history-count').textContent = history.length; $('clear-history').disabled = history.length === 0;
    const fragment = document.createDocumentFragment();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'history-empty';
      empty.textContent = search ? t('noMatches') : filter === 'favorites' ? t('emptyFavorites') : t('emptyHistory'); fragment.append(empty);
    }
    rows.forEach(row => {
      const item = document.createElement('article'); item.className = 'history-item' + (active?.url === row.url ? ' current' : '');
      const top = document.createElement('div'); top.className = 'history-item-top';
      const open = document.createElement('button'); open.className = 'history-open'; open.setAttribute('aria-label', t('playItem', { title: row.title })); open.innerHTML = `<span class="history-thumb">${icon('play')}</span><span class="history-info"><strong></strong><small></small></span>`;
      open.querySelector('strong').textContent = row.title; open.querySelector('small').textContent = C.sourceHost(row.url); open.addEventListener('click', () => { prefilledSource = true; $('source-title').value = row.title; $('source-type').value = row.type; $('source-url').value = row.url; selectSourceTab(false); loadOnline(row.url, row.title, row.type); });
      const actions = document.createElement('div'); actions.className = 'history-actions';
      const star = buttonIcon('star', row.favorite ? t('unfavoriteItem', { title: row.title }) : t('favoriteItem', { title: row.title }), () => toggleFavorite(row.url)); star.setAttribute('aria-pressed', String(row.favorite));
      const remove = buttonIcon('trash-can', t('removeItem', { title: row.title }), () => { if (active?.url === row.url) active.removed = true; history = history.filter(entry => entry.url !== row.url); persistHistory(); updateFavorite(); }); actions.append(star, remove); top.append(open, actions); item.append(top);
      const meta = document.createElement('div'); meta.className = 'history-meta'; const progress = document.createElement('span'); progress.textContent = row.live ? t('live') : `${C.formatTime(row.time)} / ${C.formatTime(row.duration)}`; const date = document.createElement('span'); date.textContent = new Date(row.updatedAt).toLocaleDateString(locale, { month: '2-digit', day: '2-digit' }); meta.append(progress, date); item.append(meta);
      const bar = document.createElement('div'); bar.className = 'progress-track'; const fill = document.createElement('span'); fill.style.width = `${row.duration ? Math.min(100, row.time / row.duration * 100) : 0}%`; bar.append(fill); item.append(bar); fragment.append(item);
    });
    $('history-list').replaceChildren(fragment); updateFavorite(); updateCallCopy();
  }
  function saveProgress(force = false) {
    if (!art || !active?.ready || active.local || active.removed || active.history === false || !prefs.remember) return;
    if (!force && Date.now() - lastSave < 5000) return;
    const video = art.video; const old = history.find(row => row.url === active.url);
    history = C.upsertHistory(history, { url: active.url, type: active.type, title: active.title, time: active.live ? 0 : video.currentTime, duration: active.live ? 0 : video.duration, live: active.live, favorite: old?.favorite || false, updatedAt: Date.now() });
    lastSave = Date.now(); persistHistory(force); updateFavorite();
  }
  function stopWatchdog() { clearTimeout(watchdog); }
  function startWatchdog(id) { stopWatchdog(); watchdog = setTimeout(() => { if (session === id) fail(t('timeout'), t('timeoutDetail')); }, 30000); }
  function fail(title, detail) {
    stopWatchdog(); clearTimeout(recoveryTimer); if (active) active.failed = true;
    if (hls) hls.stopLoad(); if (art) art.video.pause();
    setStatus(t('playbackProblem'), 'error'); $('error-title').textContent = title; $('error-detail').textContent = detail; $('player-error').hidden = false;
  }
  function cleanUp() {
    captions?.destroy(); captions = null; if ($('caption-dialog').open) $('caption-dialog').close();
    toggleLights(false); $('lights-toggle').disabled = true; $('share-qr').disabled = true;
    if ($('share-dialog').open) $('share-dialog').close();
    session++; subtitleRequest?.abort(); subtitleRequest = null; stopWatchdog(); clearTimeout(recoveryTimer); clearInterval(timer); saveProgress(true);
    active = null;
    if (hls) { hls.destroy(); hls = null; }
    if (art) { art.destroy(false); art = null; }
    if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
    if (subtitleUrl) { URL.revokeObjectURL(subtitleUrl); subtitleUrl = null; }
    trackElement = null; $('player').replaceChildren(); nativeHls = false;
  }
  function setOptions(select, rows, value) { select.replaceChildren(...rows.map(row => new Option(row.label, String(row.value)))); if (value !== undefined) select.value = String(value); }
  function updateAudio() {
    const tracks = hls?.audioTracks || [];
    $('audio-control').hidden = tracks.length < 2;
    if (hls && active?.audio !== null && active?.audio !== undefined && active.audio < tracks.length && !active.audioApplied) { hls.audioTrack = active.audio; active.audioApplied = true; }
    setOptions($('audio-select'), tracks.map((track, i) => ({ value: i, label: track.name || track.lang || t('trackNumber', { number: i + 1 }) })), hls?.audioTrack);
  }
  function updateSubtitles() {
    if (!art) return;
    const selected = $('subtitle-select').value;
    const rows = [{ value: 'off', label: t('off') }];
    if (hls) hls.subtitleTracks.forEach((track, i) => rows.push({ value: 'hls:' + i, label: track.name || track.lang || t('subtitleNumber', { number: i + 1 }) }));
    else Array.from(art.video.textTracks).forEach((track, i) => { if (track !== trackElement?.track && ['subtitles', 'captions'].includes(track.kind)) rows.push({ value: 'native:' + i, label: track.label || track.language || t('subtitleNumber', { number: i + 1 }) }); });
    if (trackElement) rows.push({ value: 'local', label: trackElement.label });
    setOptions($('subtitle-select'), rows, rows.some(row => row.value === selected) ? selected : 'off');
    $('subtitle-control').hidden = rows.length < 2; $('subtitle-settings').hidden = rows.length < 2; updateCaptionSelection();
    if (rows.length > 1) $('stream-tools').hidden = false;
  }
  function chooseSubtitle(value) {
    if (!art) return;
    Array.from(art.video.textTracks).forEach(track => { if (['subtitles', 'captions'].includes(track.kind)) track.mode = 'disabled'; });
    if (hls) { hls.subtitleDisplay = false; hls.subtitleTrack = value.startsWith('hls:') ? Number(value.split(':')[1]) : -1; hls.subtitleDisplay = value.startsWith('hls:'); }
    if (value === 'local' && trackElement) trackElement.track.mode = 'showing';
    else if (value.startsWith('native:')) { const track = art.video.textTracks[Number(value.split(':')[1])]; if (track) track.mode = 'showing'; }
    updateCaptionSelection();
  }
  function buildHls(video, url, id) {
    // Prefer Safari's native HLS, including iOS playback and picture-in-picture.
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
    if (video.canPlayType('application/vnd.apple.mpegurl') && (isSafari || !window.Hls?.isSupported())) { nativeHls = true; video.src = url; $('stream-tools').hidden = false; setOptions($('quality-select'), [{ value: -1, label: t('systemAuto') }]); $('quality-select').disabled = true; return; }
    if (!window.Hls?.isSupported()) { queueMicrotask(() => { if (session === id) fail(t('unsupportedHls'), t('unsupportedHlsDetail')); }); return; }
    const engine = hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 30 });
    let networkRetries = 0, mediaRetries = 0;
    engine.on(Hls.Events.MANIFEST_PARSED, () => {
      if (session !== id) return;
      $('stream-tools').hidden = false; $('quality-select').disabled = engine.levels.length < 2;
      setOptions($('quality-select'), [{ value: -1, label: t('auto') }, ...engine.levels.map((level, index) => ({ value: index, label: `${level.height ? level.height + 'p' : t('qualityNumber', { number: index + 1 })}${level.bitrate ? ' · ' + (level.bitrate / 1e6).toFixed(1) + ' Mbps' : ''}` }))], -1);
      const quality = window.PlayerLinks.selectQuality(engine.levels, active?.quality);
      if (quality >= 0) { engine.currentLevel = quality; $('quality-select').value = String(quality); }
      engine.subtitleTrack = -1; engine.subtitleDisplay = false; updateAudio(); updateSubtitles();
    });
    engine.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      if (session !== id || !active) return; active.live = data.details.live;
      $('live-edge').hidden = !active.live; $('loop-toggle').disabled = active.live; video.loop = !active.live && (active.loop ?? prefs.loop);
      $('stream-format').textContent = active.live ? 'HLS · ' + t('live') : 'HLS';
    });
    const syncCaptions = () => { if (session === id) queueMicrotask(() => { if (session === id) captions?.sync(); }); };
    for (const event of [Hls.Events.CUES_PARSED, Hls.Events.SUBTITLE_FRAG_PROCESSED, Hls.Events.FRAG_PARSING_USERDATA]) engine.on(event, syncCaptions);
    engine.on(Hls.Events.AUDIO_TRACKS_UPDATED, updateAudio); engine.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, updateSubtitles);
    engine.on(Hls.Events.ERROR, (_, data) => {
      if (session !== id || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) { setStatus(t('reconnecting')); recoveryTimer = setTimeout(() => { if (session === id) engine.startLoad(); }, 1000 * networkRetries); return; }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) { engine.recoverMediaError(); return; }
      const code = data.response?.code;
      fail(t('cannotPlay'), data.type === Hls.ErrorTypes.NETWORK_ERROR ? (code === 404 ? t('notFound') : code === 401 || code === 403 ? t('accessDenied') : t('networkError')) : t('decodeError'));
    });
    engine.loadSource(url); engine.attachMedia(video);
  }
  async function tryPlay(instance, id) {
    try { await instance.play(); } catch (error) { if (session !== id || active?.failed) return; if (error.name === 'NotAllowedError') { stopWatchdog(); setStatus(t('clickToPlay')); toast(t('blockedAutoplay')); } }
  }
  function start(source) {
    if (!window.Artplayer) { message(t('missingPlayer'), true); return; }
    cleanUp(); const id = session; active = { ...source, ready: false, live: false, removed: false, failed: false, audioApplied: false }; if (source.local) localUrl = source.url;
    const saved = prefs.remember && !source.local && source.history !== false && source.resume !== false ? history.find(row => row.url === source.url) : null;
    $('watch-column').hidden = false; $('workspace').classList.add('has-source'); $('player-error').hidden = true; $('stream-tools').hidden = true; $('audio-control').hidden = true; $('subtitle-control').hidden = true; $('subtitle-settings').hidden = true; $('live-edge').hidden = true;
    setOptions($('subtitle-select'), [{ value: 'off', label: t('off') }]); setOptions($('quality-select'), [{ value: -1, label: t('originalQuality') }]); $('quality-select').disabled = true;
    $('video-title').textContent = source.title; $('video-detail').textContent = source.local ? t('localPrivate') : C.sourceHost(source.url); $('stream-format').textContent = source.type === 'hls' ? 'HLS' : source.local ? t('local') : 'HTML5';
    setStatus(t('loading')); message(t('sourceHint')); $('subtitle-pick').disabled = false; $('lights-toggle').disabled = false; $('share-qr').disabled = false; $('loop-toggle').disabled = false; $('loop-toggle').setAttribute('aria-pressed', String(source.loop ?? prefs.loop));
    active.lastVolume = source.volume ?? prefs.volume; active.lastRate = source.rate ?? prefs.rate;
    try {
      Artplayer.CONTEXTMENU = false; Artplayer.RECONNECT_TIME_MAX = 0;
      const instance = art = new Artplayer({ icons: playerIcons, container: $('player'), url: source.url, type: source.type === 'hls' ? 'm3u8' : 'auto', customType: { m3u8: (video, url) => buildHls(video, url, id) }, theme: '#602f75', lang: locale.toLowerCase(), i18n: { [locale.toLowerCase()]: playerMessages }, volume: source.volume ?? prefs.volume, muted: source.muted === true, poster: source.poster || '', autoplay: false, loop: source.loop ?? prefs.loop, pip: true, fullscreen: true, fullscreenWeb: true, setting: true, playbackRate: true, aspectRatio: true, flip: true, hotkey: false, mutex: true, playsInline: true, autoPlayback: false, moreVideoAttr: { playsInline: true, preload: 'metadata' } });
      const video = instance.video; captions = Caption.attach(video, captionStyle); $('caption-delay').value = '0'; $('player').tabIndex = 0; $('player').setAttribute('role', 'region');
      let restored = false;
      const onMetadata = () => {
        if (session !== id || !active) return;
        active.ready = true; if (nativeHls) active.live = !Number.isFinite(video.duration);
        if (nativeHls) { $('live-edge').hidden = !active.live; $('loop-toggle').disabled = active.live; video.loop = !active.live && (active.loop ?? prefs.loop); }
        if (!restored) {
          restored = true;
          const explicitStart = source.start !== null && source.start !== undefined && !active.live && Number.isFinite(video.duration);
          const time = explicitStart ? Math.min(source.start, Math.max(0, video.duration - .1)) : C.resumeTime(saved, video.duration, active.live);
          if (time || explicitStart) { video.currentTime = time; if (!explicitStart && time) toast(t('resumed', {time: C.formatTime(time)})); }
          video.playbackRate = source.rate ?? prefs.rate;
        }
        $('video-detail').textContent = `${source.local ? t('localNoUpload') : C.sourceHost(source.url)} · ${active.live ? t('live') : C.formatTime(video.duration)}${video.videoHeight ? ' · ' + video.videoHeight + 'p' : ''}`;
        updateSubtitles(); saveProgress(true); updateFavorite();
      };
      instance.on('video:loadedmetadata', onMetadata);
      instance.on('video:canplay', () => { if (session === id && !active.failed) { stopWatchdog(); if (video.paused) setStatus(t('ready')); } });
      instance.on('video:playing', () => { if (session !== id) return; stopWatchdog(); active.failed = false; $('player-error').hidden = true; setStatus(active.live ? t('livePlaying') : t('playing'), 'playing'); saveProgress(true); });
      instance.on('video:pause', () => { if (session !== id || active?.failed) return; stopWatchdog(); setStatus(t('paused')); saveProgress(true); });
      instance.on('video:waiting', () => { if (session === id && !active.failed) { setStatus(t('buffering')); startWatchdog(id); } });
      instance.on('video:ended', () => { if (session !== id) return; setStatus(t('ended')); saveProgress(true); const next = playlistIndex() + 1; if (queueAuto && !video.loop && next > 0 && next < playlist.length) queueMicrotask(() => { if (session === id && queueAuto) playQueue(next); }); });
      instance.on('video:error', () => { if (session === id && !hls) fail(t('cannotPlay'), t('fileError')); });
      instance.on('video:volumechange', () => { if (session === id && video.volume !== active.lastVolume) { active.lastVolume = video.volume; prefs.volume = video.volume; savePrefs(); } });
      instance.on('video:ratechange', () => { if (session === id && video.playbackRate !== active.lastRate) { active.lastRate = video.playbackRate; prefs.rate = video.playbackRate; savePrefs(); } });
      video.textTracks.addEventListener('addtrack', updateSubtitles);
      instance.once('ready', () => {
        if (session !== id || active.failed) return;
        if (source.aspect && source.aspect !== 'auto') instance.aspectRatio = source.aspect;
        if (source.subtitle) loadRemoteSubtitle(source.subtitle, id);
        if (source.autoplay !== false) tryPlay(instance, id);
      });
      timer = setInterval(() => saveProgress(), 5000); startWatchdog(id); renderHistory(); renderPlaylist(); if (source.lights) toggleLights(true);
    } catch { fail(t('initError'), t('initErrorDetail')); }
  }
  function loadOnline(url, title = '', type = 'auto', options = {}) {
    try { const source = C.parseSource(url, type, location.protocol); start({ ...options, ...source, title: title.trim().slice(0, 120) || C.sourceTitle(source.url), local: false }); }
    catch (error) { message(t(error.code || 'initErrorDetail'), true); $('source-url').focus(); }
  }
  function loadFile(file) {
    if (!file) return;
    if (/\.m3u8?$/i.test(file.name)) { toast(t('localHlsError')); return; }
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(file.name)) { toast(t('fileTypeError')); return; }
    if (!file.size) { toast(t('emptyFile')); return; }
    selectSourceTab(true); start({ url: URL.createObjectURL(file), title: file.name.slice(0, 120), type: 'video', local: true, file });
  }
  async function addSubtitle(file, label) {
    if (!file || !art) return;
    if (!label) { subtitleRequest?.abort(); subtitleRequest = null; }
    if (!/\.(srt|vtt)$/i.test(file.name) || file.size > 5 * 1024 * 1024) { toast(t('subtitleSizeError')); return; }
    const id = session;
    try {
      const text = C.toVtt(await file.text()); if (session !== id || !art) return;
      if (trackElement) trackElement.remove(); if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
      subtitleUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' })); const track = trackElement = document.createElement('track'); track.kind = 'subtitles'; track.label = label || file.name.slice(0, 80); track.srclang = 'und'; track.src = subtitleUrl; track.default = true;
      track.addEventListener('load', () => { if (session === id) { updateSubtitles(); $('subtitle-select').value = 'local'; chooseSubtitle('local'); toast(t('subtitleAdded')); } });
      track.addEventListener('error', () => { if (session === id) toast(t('subtitleEncodingError')); });
      art.video.append(track); updateSubtitles(); chooseSubtitle('local'); $('subtitle-select').value = 'local';
    } catch (error) { toast(t(error.code || 'subtitleEncodingError')); }
  }
  async function loadRemoteSubtitle(url, id) {
    const controller = new AbortController(); subtitleRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {signal: controller.signal, referrerPolicy: 'no-referrer'});
      const limit = 5 * 1024 * 1024;
      if (!response.ok || Number(response.headers.get('Content-Length')) > limit || !response.body) throw new Error('Subtitle unavailable');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('Subtitle too large'); }
        chunks.push(chunk.value);
      }
      if (session !== id || !art) return;
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      await addSubtitle(new File([text], 'subtitles.vtt', {type: 'text/vtt'}), t('subtitles'));
    } catch (_) {
      if (session === id && art && !active?.failed && subtitleRequest === controller) toast(t('callSubtitleError'));
    } finally {
      clearTimeout(timeout); if (subtitleRequest === controller) subtitleRequest = null;
    }
  }

  const languageConfig = JSON.parse($('language-config').textContent);
  const callBase = location.origin + languageConfig.languages.find(language => language.code === locale).path;
  const exampleCall = window.PlayerLinks.build(callBase, {url: 'https://example.com/video.m3u8'});
  // Display a readable simple example; copy uses the encoded URL builder.
  document.querySelectorAll('[data-call-example="url"]').forEach(node => { node.textContent = callBase + '#url=https://example.com/video.m3u8'; });

  function callSource() {
    if (active && !active.local) {
      const video = art?.video;
      const selectedQuality = Number($('quality-select').value);
      return {...active, lang: locale, autoplay: true, muted: video?.muted || false,
        volume: video?.volume ?? active.volume, rate: video?.playbackRate ?? active.rate,
        start: active.ready && !active.live ? Math.floor(video.currentTime) : active.start,
        loop: video?.loop ?? active.loop, theater: document.body.classList.contains('theater'), lights: document.body.classList.contains('lights-out'),
        quality: hls && selectedQuality >= 0 ? hls.levels[selectedQuality]?.height : active.quality,
        aspect: art?.aspectRatio || 'auto'};
    }
    try {
      const source = C.parseSource($('source-url').value, $('source-type').value, location.protocol);
      return {...source, title: $('source-title').value, lang: locale};
    } catch (_) { return null; }
  }

  function updateCallCopy() {
    const label = $('call-copy-label');
    if (label) label.textContent = t(callSource() ? 'callCopyLink' : 'callCopyExample');
  }

  async function copyCall(text) {
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {
      const input = document.createElement('textarea'); input.value = text;
      input.style.cssText = 'position:fixed;inset:0 auto auto -9999px;';
      document.body.append(input); input.select();
      try { copied = document.execCommand('copy'); } catch (_) { /* Show the manual-copy fallback. */ }
      input.remove();
    }
    toast(t(copied ? 'callCopied' : 'callCopyFailed'));
  }
  $('call-copy').onclick = () => { const source = callSource(); copyCall(source ? window.PlayerLinks.build(callBase, source) : exampleCall); };
  function exportHistory() {
    saveProgress(true);
    const rows = C.cleanHistory(history);
    if (!rows.length) return;
    try {
      const lines = ['m3u8-player.com', `${t('history')} (${rows.length})`, ''];
      rows.forEach((row, index) => {
        lines.push(`${index + 1}. ${row.favorite ? '★ ' : ''}${row.title.replace(/\s+/g, ' ')}`,
          `URL: ${row.url}`, `${t('format')}: ${row.type === 'hls' ? 'HLS / M3U8' : 'HTML5'}`,
          `${t('historyProgress')}: ${row.live ? t('live') : C.formatTime(row.time) + ' / ' + C.formatTime(row.duration)}`,
          `${t('historyUpdated')}: ${new Date(row.updatedAt).toLocaleString(locale)}`, '');
      });
      const blob = new Blob(['\uFEFF', lines.join('\r\n')], {type: 'text/plain;charset=utf-8'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      const date = new Date(), day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      link.href = url; link.download = 'm3u8-player-history-' + day + '.txt'; link.hidden = true;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      toast(t('historyExportReady'));
    } catch (_) { toast(t('historyExportError')); }
  }
  $('export-history').onclick = exportHistory;

  let qrLibrary, shareSource, shareRender = 0;
  function fitShareCanvas() {
    const canvas = $('share-canvas'), modules = Number(canvas.dataset.modules);
    if (!modules || !$('share-dialog').open) return;
    const available = Math.max(1, Math.min(280, $('share-dialog').clientWidth - 66));
    const width = modules * Math.max(1, Math.floor(available / modules)) + 'px';
    if (canvas.style.width !== width) canvas.style.width = width;
  }
  if (window.ResizeObserver) new ResizeObserver(fitShareCanvas).observe($('share-dialog'));
  else window.addEventListener('resize', fitShareCanvas);
  function loadQrLibrary() {
    if (window.qrcodegen) return Promise.resolve(window.qrcodegen);
    if (!qrLibrary) qrLibrary = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => finish(false), 10000);
      function finish(ok) {
        clearTimeout(timeout); script.onload = script.onerror = null;
        if (ok && window.qrcodegen) resolve(window.qrcodegen);
        else { script.remove(); qrLibrary = null; reject(new Error('QR library unavailable')); }
      }
      script.onload = () => finish(true); script.onerror = () => finish(false);
      script.src = $('share-qr').dataset.qrLibrary;
      document.head.append(script);
    });
    return qrLibrary;
  }
  async function renderShareQr() {
    const id = ++shareRender, canvas = $('share-canvas'), status = $('share-status');
    const source = {...shareSource, start: $('share-position').checked ? shareSource.start : null};
    const link = window.PlayerLinks.build(callBase, source);
    $('share-link').value = link; updateSystemShare(); canvas.hidden = true;
    status.hidden = false; status.textContent = t('loading'); status.classList.remove('error');
    try {
      const library = await loadQrLibrary();
      if (id !== shareRender || !$('share-dialog').open) return;
      const qr = library.QrCode.encodeText(link, library.QrCode.Ecc.MEDIUM);
      const border = 4, scale = 4;
      canvas.width = canvas.height = (qr.size + border * 2) * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#111';
      for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
      canvas.dataset.modules = String(qr.size + border * 2); fitShareCanvas();
      canvas.hidden = false; status.hidden = true;
    } catch (error) {
      if (id !== shareRender || !$('share-dialog').open) return;
      status.textContent = t(error instanceof RangeError ? 'qrTooLong' : 'qrError'); status.classList.add('error');
    }
  }
  $('share-qr').onclick = () => {
    if (!active) return;
    if (active.local) { toast(t('qrLocal')); return; }
    shareSource = {url: active.url, title: active.title, type: active.type, lang: locale};
    const time = active.ready && !active.live ? Math.floor(art.video.currentTime) : 0;
    shareSource.start = time; $('share-position').checked = false; $('share-system-note').textContent = t('systemShareFallback');
    $('share-position-row').hidden = !time;
    $('share-position-label').textContent = t('qrAtTime', {time: C.formatTime(time)});
    $('share-video-title').textContent = active.title;
    $('share-dialog').showModal(); $('share-title').focus({preventScroll: true});
    renderShareQr();
  };
  $('share-position').onchange = renderShareQr;
  function updateSystemShare() {
    let supported = window.isSecureContext && typeof navigator.share === 'function';
    try { if (supported && typeof navigator.canShare === 'function') supported = navigator.canShare({url: $('share-link').value}); } catch (_) { supported = false; }
    $('share-system').hidden = !supported; $('share-system-note').hidden = supported;
    $('share-copy').classList.toggle('secondary-button', supported);
    $('share-copy').classList.toggle('primary-button', !supported);
  }
  $('share-system').onclick = async () => {
    if (!shareSource) return;
    const button = $('share-system'); button.disabled = true;
    try { await navigator.share({title: shareSource.title || t('siteName'), url: $('share-link').value}); }
    catch (error) { if (error.name !== 'AbortError') { $('share-system-note').textContent = t('systemShareError'); $('share-system-note').hidden = false; } }
    finally { button.disabled = false; }
  };
  $('share-copy').onclick = () => copyCall($('share-link').value);
  $('share-link').onclick = event => event.target.select();
  $('share-dialog').addEventListener('close', () => { shareRender++; shareSource = null; });
  $('source-url').addEventListener('input', updateCallCopy);
  $('source-form').addEventListener('submit', event => { event.preventDefault(); if (!$('url-pane').hidden) loadOnline($('source-url').value, $('source-title').value, $('source-type').value, launchOptions?.url === $('source-url').value ? {...launchOptions, autoplay: true} : {}); });
  $('url-tab').onclick = () => selectSourceTab(false); $('local-tab').onclick = () => selectSourceTab(true);
  $('all-tab').onclick = () => selectFilter('all'); $('favorites-tab').onclick = () => selectFilter('favorites');
  tabsKeyboard(['url-tab', 'local-tab']); tabsKeyboard(['all-tab', 'favorites-tab']);
  $('clear-url').onclick = () => { $('source-url').value = ''; $('source-title').value = ''; message(t('sourceHint')); updateCallCopy(); $('source-url').focus(); };
  $('source-url').addEventListener('input', () => { if (prefilledSource) { $('source-title').value = ''; $('source-type').value = 'auto'; prefilledSource = false; launchOptions = null; } message(t('sourceHint')); });
  $('advanced-toggle').onclick = () => { const expanded = $('advanced-options').hidden; $('advanced-options').hidden = !expanded; $('advanced-toggle').setAttribute('aria-expanded', String(expanded)); };
  const demo = () => { prefilledSource = true; selectSourceTab(false); $('source-url').value = DEMO; $('source-title').value = t('demoTitle'); $('source-type').value = 'hls'; loadOnline(DEMO, $('source-title').value, 'hls'); };
  $('demo-button').onclick = () => { $('help-dialog').close(); demo(); };
  $('local-pick').onclick = () => $('video-file').click();
  $('video-file').onchange = event => { loadFile(event.target.files[0]); event.target.value = ''; };
  $('subtitle-pick').onclick = () => $('subtitle-file').click();
  $('subtitle-file').onchange = event => { addSubtitle(event.target.files[0]); event.target.value = ''; };
  $('history-search').addEventListener('input', renderHistory);
  $('favorite-current').onclick = () => { if (active) toggleFavorite(active.url); };
  $('remember-history').checked = prefs.remember;
  $('remember-history').onchange = () => { prefs.remember = $('remember-history').checked; savePrefs(); if (prefs.remember) saveProgress(true); toast(prefs.remember ? t('historyOn') : t('historyOff')); };
  $('loop-toggle').onclick = () => { prefs.loop = art ? !art.video.loop : !prefs.loop; if (active) active.loop = prefs.loop; if (art) art.video.loop = prefs.loop; $('loop-toggle').setAttribute('aria-pressed', String(prefs.loop)); savePrefs(); };
  function toggleTheater(force) { const enabled = typeof force === 'boolean' ? force : !document.body.classList.contains('theater'); document.body.classList.toggle('theater', enabled); $('theater-toggle').setAttribute('aria-pressed', String(enabled)); }
  $('theater-toggle').onclick = () => toggleTheater();
  function toggleLights(force) {
    const enabled = art && active && (typeof force === 'boolean' ? force : !document.body.classList.contains('lights-out'));
    const overlay = $('lights-overlay');
    if (enabled && overlay.hidden) { overlay.hidden = false; void overlay.offsetWidth; }
    document.body.classList.toggle('lights-out', Boolean(enabled));
    overlay.setAttribute('aria-hidden', String(!enabled));
    if (active) active.lights = Boolean(enabled);
    $('lights-toggle').setAttribute('aria-pressed', String(Boolean(enabled)));
    $('lights-label').textContent = t(enabled ? 'lightsOn' : 'lightsOff');
    if (enabled && !lightsInert.length) {
      lightsInert = [...document.querySelectorAll('.site-header, .source-card, .history-column, .site-footer')].map(node => [node, node.inert]);
      lightsInert.forEach(([node]) => { node.inert = true; });
      if (!$('watch-column').contains(document.activeElement)) $('player').focus({preventScroll: true});
    } else if (!enabled) {
      lightsInert.forEach(([node, previous]) => { node.inert = previous; }); lightsInert = [];
      if (document.activeElement === $('lights-overlay')) $('lights-toggle').focus({preventScroll: true});
    }
  }
  $('lights-toggle').onclick = () => toggleLights();
  $('lights-overlay').onclick = () => toggleLights(false);
  $('quality-select').onchange = () => { if (hls) hls.currentLevel = Number($('quality-select').value); };
  $('audio-select').onchange = () => { if (hls) hls.audioTrack = Number($('audio-select').value); };
  $('subtitle-select').onchange = () => chooseSubtitle($('subtitle-select').value);
  $('live-edge').onclick = () => { if (!art) return; const ranges = art.video.seekable; const time = hls?.liveSyncPosition ?? (ranges.length ? ranges.end(ranges.length - 1) - 2 : null); if (time !== null) { art.video.currentTime = Math.max(0, time); tryPlay(art, session); } };
  $('retry-button').onclick = () => { if (!active) return; const source = { ...active }; if (source.local && source.file) loadFile(source.file); else loadOnline(source.url, source.title, source.type, {...source, autoplay: true}); };
  document.querySelectorAll('[data-help]').forEach(button => button.onclick = () => $('help-dialog').showModal());
  $('keyboard-help').onclick = () => $('help-dialog').showModal();
  $('footer-year').textContent = new Date().getFullYear();
  let privacyRequest;
  $('privacy-help').onclick = async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); $('privacy-dialog').showModal(); $('privacy-title').focus();
    const content = $('privacy-dialog').querySelector('.privacy-scroll'); content.scrollTop = 0;
    if (content.querySelector('.privacy-copy')) return;
    content.textContent = 'Loading privacy policy…'; content.setAttribute('aria-busy', 'true');
    try {
      privacyRequest ||= fetch('/privacy/policy.json').then(response => { if (!response.ok) throw new Error('Policy unavailable'); return response.json(); });
      const policy = await privacyRequest;
      const copy = new DOMParser().parseFromString(policy.html, 'text/html').querySelector('.privacy-copy');
      if (!copy) throw new Error('Invalid policy');
      content.replaceChildren(document.importNode(copy, true));
    } catch {
      privacyRequest = null;
      content.textContent = 'The policy could not be loaded. Please use “Open full page” below or try again.';
    } finally { content.removeAttribute('aria-busy'); }
  };
  const updateBackTop = () => { $('back-to-top').hidden = window.scrollY < 400; };
  window.addEventListener('scroll', updateBackTop, { passive: true }); updateBackTop();
  $('back-to-top').onclick = () => { window.scrollTo({ top: 0, behavior: 'instant' }); ($('url-pane').hidden ? $('local-pick') : $('source-url')).focus({ preventScroll: true }); };

  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  $('clear-history').onclick = () => $('clear-dialog').showModal();
  $('confirm-clear').onclick = () => { history = []; if (active) active.removed = true; persistHistory(); $('clear-dialog').close(); toast(t('historyCleared')); };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (!document.querySelector('dialog[open]')) { toggleLights(false); toggleTheater(false); } return; }
    if (!art || !active?.ready || !$('player').contains(document.activeElement) || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.altKey || event.ctrlKey || event.metaKey) return;
    const video = art.video; const key = event.key.toLowerCase();
    if (![' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'm', 'f'].includes(key)) return;
    event.preventDefault();
    if (key === ' ') { if (video.paused) tryPlay(art, session); else video.pause(); }
    else if (key === 'm') video.muted = !video.muted;
    else if (key === 'f') { try { art.fullscreen = !art.fullscreen; } catch { toast(t('fullscreenUnsupported')); } }
    else if (key === 'arrowup' || key === 'arrowdown') video.volume = Math.min(1, Math.max(0, video.volume + (key === 'arrowup' ? .1 : -.1)));
    else if (video.seekable.length) { const min = video.seekable.start(0); const max = video.seekable.end(video.seekable.length - 1); video.currentTime = Math.min(max, Math.max(min, video.currentTime + (key === 'arrowright' ? 5 : -5))); }
  });
  $('player').addEventListener('pointerdown', event => { if (!event.target.closest('button, input, select, .art-control')) $('player').focus({ preventScroll: true }); });
  let dragDepth = 0;
  document.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const file = event.dataTransfer.files[0]; if (file && /\.(vtt|srt)$/i.test(file.name)) { if (art) addSubtitle(file); else toast(t('openBeforeSubtitle')); } else loadFile(file); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(true); });
  window.addEventListener('pagehide', () => saveProgress(true));
  window.addEventListener('storage', event => {
    if (event.key === C.HISTORY_KEY || event.key === null) { history = C.cleanHistory(read(C.HISTORY_KEY, [])); if (active?.ready && !active.local && !history.some(row => row.url === active.url)) active.removed = true; renderHistory(); }
    if (event.key === Caption.KEY || event.key === null) { captionStyle = Caption.cleanStyle(read(Caption.KEY, {})); captions?.applyStyle(captionStyle); updateCaptionPreview(); }
    if (event.key === Q.KEY || event.key === null) { playlist = Q.clean(read(Q.KEY, []), location.protocol); renderPlaylist(); }
    if (event.key === Q.OPTIONS_KEY || event.key === null) { queueAuto = read(Q.OPTIONS_KEY, {})?.auto !== false; $('playlist-auto').checked = queueAuto; }
    if (event.key === C.PREFS_KEY) { const value = read(C.PREFS_KEY, {}); prefs.remember = value?.remember !== false; $('remember-history').checked = prefs.remember; }
  });
  renderHistory();
  if (!window.Artplayer || !window.Hls) message(t('missingResources'), true);
  function handlePlaybackRequest() {
    const launch = window.PlayerLaunch;
    delete window.PlayerLaunch;
    if (!launch || typeof launch.url !== 'string') return;
    selectSourceTab(false); prefilledSource = true;
    $('source-url').value = launch.url;
    $('source-title').value = launch.title;
    $('source-type').value = launch.type;
    launchOptions = launch;
    toggleTheater(launch.theater);
    loadOnline(launch.url, launch.title, launch.type, launch);
  }
  window.addEventListener('player:launch', handlePlaybackRequest);
  handlePlaybackRequest();
})();
