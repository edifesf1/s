(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayerCaptions = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const KEY = 'm3u8play.caption-style.v1';
  function cleanStyle(value) {
    return {size: ['small','medium','large','xlarge'].includes(value?.size) ? value.size : 'default', background: ['soft','solid','none'].includes(value?.background) ? value.background : 'default'};
  }
  function attach(video, style) {
    const originals = new WeakMap(), states = new WeakMap(), tracks = new Set(); let delay = 0, syncing = false, destroyed = false, restoring = false;
    function sync() {
      if (syncing || destroyed) return;
      syncing = true;
      try {
        for (const track of video.textTracks) {
          if (!['subtitles','captions'].includes(track.kind)) continue;
          if (!tracks.has(track)) { tracks.add(track); track.addEventListener('cuechange', sync); }
          let cues;
          try { cues = track.cues; } catch (_) { continue; }
          const length = cues?.length || 0, first = cues?.[0], last = cues?.[length - 1], state = states.get(track);
          if (state && state.length === length && state.first === first && state.last === last && state.delay === delay && !restoring) continue;
          states.set(track, {length, first, last, delay});
          for (const cue of Array.from(cues || [])) {
            if (!originals.has(cue)) originals.set(cue, {start: cue.startTime, end: cue.endTime, line: cue.line, snapToLines: cue.snapToLines});
            const original = originals.get(cue), end = Math.max(0, original.end + delay), start = Math.min(end, Math.max(0, original.start + delay));
            try {
              if (cue.startTime !== start) cue.startTime = start;
              if (cue.endTime !== end) cue.endTime = end;
              // Keep automatically placed captions above the player's own controls.
              // Authored WebVTT positions and closed-caption line numbers stay intact.
              if (original.line === 'auto' && original.snapToLines !== false) {
                const line = restoring ? original.line : -3;
                if (cue.line !== line) cue.line = line;
              }
            } catch (_) { /* Some native media tracks are controlled by the browser. */ }
          }
        }
      } finally { syncing = false; }
    }
    function applyStyle(value) {
      const cleaned = cleanStyle(value);
      if (cleaned.size === 'default') delete video.dataset.captionSize; else video.dataset.captionSize = cleaned.size;
      if (cleaned.background === 'default') delete video.dataset.captionBackground; else video.dataset.captionBackground = cleaned.background;
    }
    video.textTracks.addEventListener('addtrack', sync); video.textTracks.addEventListener('change', sync);
    for (const event of ['loadeddata','timeupdate','seeked']) video.addEventListener(event, sync);
    applyStyle(style); sync();
    return {
      sync, applyStyle, getDelay: () => delay,
      setDelay(value) { if (Number.isFinite(value)) delay = Math.round(Math.min(60, Math.max(-60, value)) * 10) / 10; sync(); return delay; },
      destroy() {
        delay = 0; restoring = true; sync(); destroyed = true;
        video.textTracks.removeEventListener('addtrack', sync); video.textTracks.removeEventListener('change', sync);
        for (const event of ['loadeddata','timeupdate','seeked']) video.removeEventListener(event, sync);
        tracks.forEach(track => track.removeEventListener('cuechange', sync)); tracks.clear();
      }
    };
  }
  return Object.freeze({KEY, cleanStyle, attach});
});
