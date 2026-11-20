
/* EdifesfPlayer - HLS Engine */
/* Adaptado para seguir a inicialização do m3u8-player.com */

export class HLSEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.instance = null;
    this.video = null;
    this.url = "";

    this.networkRetries = 0;
    this.mediaRetries = 0;

    this.recoveryTimer = null;
    this.destroyed = false;
  }

  emit(name, ...args) {
    if (typeof this.callbacks[name] === "function") {
      this.callbacks[name](...args);
    }
  }

  load(video, url) {
    this.destroy();

    this.destroyed = false;
    this.video = video;
    this.url = url;

    this.networkRetries = 0;
    this.mediaRetries = 0;

    if (!window.Hls) {
      this.emit("error", "HLS.js não foi carregado.");
      return;
    }

    const isSafari =
      /Safari/.test(navigator.userAgent) &&
      !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);

    const nativeSupported =
      video.canPlayType("application/vnd.apple.mpegurl");

    if (
      nativeSupported &&
      (isSafari || !window.Hls.isSupported())
    ) {
      this.loadNative(video, url);
      return;
    }

    if (!window.Hls.isSupported()) {
      this.emit("error", "Este navegador não oferece suporte a HLS.");
      return;
    }

    this.loadWithHls(video, url);
  }

  loadWithHls(video, url) {
    const Hls = window.Hls;

    this.emit("log", "HLS.js disponível. Preparando conexão...");

    const instance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30
    });

    this.instance = instance;

    instance.on(Hls.Events.MANIFEST_LOADING, () => {
      if (this.destroyed) return;

      this.emit("log", "Carregando manifesto M3U8...");
    });

    instance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      if (this.destroyed) return;

      this.networkRetries = 0;

      this.emit("manifest", {
        levels: data.levels || [],
        audioTracks: instance.audioTracks || [],
        subtitleTracks: instance.subtitleTracks || []
      });

      this.emit(
        "log",
        `Manifesto carregado: ${(data.levels || []).length} qualidade(s).`
      );
    });

    instance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      if (this.destroyed) return;

      this.emit("level", data.level);
    });

    instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (this.destroyed) return;

      this.emit("audioTracks", instance.audioTracks || []);
    });

    instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      if (this.destroyed) return;

      this.emit("subtitleTracks", instance.subtitleTracks || []);
    });

    instance.on(Hls.Events.ERROR, (event, data) => {
      if (this.destroyed || !data.fatal) return;

      const detail = data.details || data.type || "erro desconhecido";

      this.emit(
        "log",
        `HLS ${data.type} / ${detail}` +
        (data.response?.code
          ? ` / HTTP ${data.response.code}`
          : "") +
        (data.response?.url
          ? ` / ${data.response.url}`
          : "")
      );

      if (
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        this.networkRetries++ < 2
      ) {
        const delay = 1000 * this.networkRetries;

        this.emit(
          "status",
          "Falha de rede. Tentando reconectar..."
        );

        this.emit(
          "log",
          `Tentativa de recuperação de rede ${this.networkRetries}/2 em ${delay / 1000}s.`
        );

        this.recoveryTimer = setTimeout(() => {
          if (
            !this.destroyed &&
            this.instance === instance
          ) {
            instance.startLoad();
          }
        }, delay);

        return;
      }

      if (
        data.type === Hls.ErrorTypes.MEDIA_ERROR &&
        this.mediaRetries++ < 1
      ) {
        this.emit("status", "Erro de mídia. Tentando recuperar...");
        this.emit("log", "Executando recoverMediaError().");

        instance.recoverMediaError();
        return;
      }

      this.emit(
        "error",
        `Falha fatal do HLS: ${detail}`
      );
    });

    /*
      Mesma ordem de inicialização do player original:
      primeiro carrega a URL e depois conecta o vídeo.
    */

    instance.loadSource(url);
    instance.attachMedia(video);
  }

  loadNative(video, url) {
    this.emit("log", "Utilizando reprodução HLS nativa.");

    video.src = url;

    video.addEventListener(
      "loadedmetadata",
      () => {
        if (!this.destroyed) {
          this.emit(
            "status",
            "Metadados carregados. Pressione Play."
          );
        }
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        if (!this.destroyed) {
          this.emit(
            "error",
            `Erro na reprodução nativa: ${video.error?.code || "desconhecido"}`
          );
        }
      },
      { once: true }
    );
  }

  get levels() {
    return this.instance?.levels || [];
  }

  get audioTracks() {
    return this.instance?.audioTracks || [];
  }

  get subtitleTracks() {
    return this.instance?.subtitleTracks || [];
  }

  setQuality(index) {
    if (this.instance) {
      this.instance.currentLevel = index;
    }
  }

  setAudio(index) {
    if (this.instance) {
      this.instance.audioTrack = index;
    }
  }

  setSubtitle(index) {
    if (this.instance) {
      this.instance.subtitleTrack = index;
    }
  }

  destroy() {
    this.destroyed = true;

    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    if (this.instance) {
      try {
        this.instance.destroy();
      } catch (_) {}
    }

    if (this.video) {
      try {
        this.video.removeAttribute("src");
        this.video.load();
      } catch (_) {}
    }

    this.instance = null;
    this.video = null;
  }
}
