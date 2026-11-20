
/* EdifesfPlayer - HLS Engine */

export class HLSEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.instance = null;
    this.video = null;
    this.url = "";
    this.networkRetries = 0;
    this.mediaRetries = 0;
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

    video.crossOrigin = "anonymous";

    if (!window.Hls) {
      this.emit("error", "HLS.js não foi carregado.");
      return;
    }

    if (window.Hls.isSupported()) {
      this.loadWithHls(video, url);
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      this.loadNative(video, url);
      return;
    }

    this.emit("error", "Este navegador não oferece suporte a HLS.");
  }

  loadWithHls(video, url) {
    const Hls = window.Hls;

    this.emit("log", "HLS.js disponível. Preparando conexão...");

    const instance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 20000,
      levelLoadingMaxRetry: 3,
      levelLoadingRetryDelay: 1000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 3,
      fragLoadingRetryDelay: 1000
    });

    this.instance = instance;

    instance.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (this.destroyed) return;

      this.emit("log", "HLS.js conectado ao vídeo.");
      this.emit("log", "Solicitando playlist M3U8...");

      instance.loadSource(url);
    });

    instance.on(Hls.Events.MANIFEST_LOADING, () => {
      this.emit("log", "Carregando manifesto M3U8...");
    });

    instance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      this.networkRetries = 0;

      this.emit("manifest", {
        levels: data.levels || [],
        audioTracks: instance.audioTracks || [],
        subtitleTracks: instance.subtitleTracks || []
      });

      this.emit(
        "log",
        `Manifesto carregado: ${data.levels.length} qualidade(s).`
      );
    });

    instance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      this.emit("level", data.level);
    });

    instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      this.emit("audioTracks", instance.audioTracks || []);
    });

    instance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      this.emit("subtitleTracks", instance.subtitleTracks || []);
    });

    instance.on(Hls.Events.ERROR, (event, data) => {
      if (this.destroyed) return;

      const detail = data.details || data.type || "erro desconhecido";

      this.emit("log",
        `HLS ${data.type} / ${detail}` +
        (data.response?.code ? ` / HTTP ${data.response.code}` : "") +
        (data.response?.url ? ` / ${data.response.url}` : "")
      );

      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        this.recoverNetwork();
        return;
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        this.recoverMedia();
        return;
      }

      this.emit("error", `Falha fatal do HLS: ${detail}`);
    });

    instance.attachMedia(video);
  }

  recoverNetwork() {
    const instance = this.instance;

    if (!instance || this.destroyed) return;

    if (this.networkRetries < 2) {
      this.networkRetries++;

      const delay = this.networkRetries * 2000;

      this.emit(
        "log",
        `Tentativa de recuperação de rede ${this.networkRetries}/2 em ${delay / 1000}s.`
      );

      this.emit("status", "Falha de rede. Tentando reconectar...");

      setTimeout(() => {
        if (!this.destroyed && this.instance === instance) {
          instance.startLoad();
        }
      }, delay);

    } else {
      this.emit(
        "error",
        "Não foi possível recuperar a conexão. Verifique a URL, CORS e o servidor."
      );
    }
  }

  recoverMedia() {
    const instance = this.instance;

    if (!instance || this.destroyed) return;

    if (this.mediaRetries < 1) {
      this.mediaRetries++;

      this.emit("status", "Erro de mídia. Tentando recuperar...");
      this.emit("log", "Executando recoverMediaError().");

      instance.recoverMediaError();

    } else {
      this.emit("error", "Não foi possível recuperar o erro de mídia.");
    }
  }

  loadNative(video, url) {
    this.emit("log", "Utilizando reprodução HLS nativa.");

    video.src = url;

    video.addEventListener("loadedmetadata", () => {
      this.emit("status", "Metadados carregados. Pressione Play.");
    }, { once: true });

    video.addEventListener("error", () => {
      if (!this.destroyed) {
        this.emit(
          "error",
          `Erro na reprodução nativa: ${video.error?.code || "desconhecido"}`
        );
      }
    }, { once: true });
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

