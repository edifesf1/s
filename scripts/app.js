
/* EdifesfPlayer - Main App */

import { parseSource } from "./core.js";
import { HLSEngine } from "./hls-engine.js";

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const embedMode =
    new URLSearchParams(location.search).get("embed") === "1";

  if (embedMode) {
    document.documentElement.classList.add("embed-mode");
    document.body.classList.add("embed-mode");
  }

  let art = null;
  let engine = null;
  let currentUrl = "";
  let requestId = 0;

  function say(message, state = "") {
    $("status").textContent = message;
    $("dot").className = "dot" + (state ? " " + state : "");
  }

  function log(message) {
    const now = new Date().toLocaleTimeString();

    const previous =
      $("log").textContent === "Nenhum evento registrado."
        ? ""
        : $("log").textContent + "\n";

    $("log").textContent = previous + `[${now}] ${message}`;
  }

  function resetOptions() {
    $("quality").innerHTML =
      '<option value="-1">Automática</option>';
    $("quality").disabled = true;

    $("audio").innerHTML =
      '<option value="-1">Padrão</option>';
    $("audio").disabled = true;

    $("subtitles").innerHTML =
      '<option value="-1">Desativadas</option>';
    $("subtitles").disabled = true;
  }

  function stop() {
    if (engine) {
      engine.destroy();
      engine = null;
    }

    if (art) {
      try {
        art.destroy(false);
      } catch (_) {}
      art = null;
    }

    $("player").innerHTML = "";
    resetOptions();
  }

  function fillSelect(select, items, first, label) {
    select.innerHTML = "";

    const base = document.createElement("option");
    base.value = "-1";
    base.textContent = first;
    select.appendChild(base);

    (items || []).forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = label(item, index);
      select.appendChild(option);
    });

    select.disabled = !(items && items.length);
  }

  function createEngine() {
    return new HLSEngine({
      log(message) {
        log(message);
      },

      status(message) {
        say(message);
      },

      error(message) {
        say(message, "err");
        log(message);
      },

      manifest(data) {
        say(
          `Playlist carregada. ${data.levels.length} qualidade(s) disponível(is).`,
          "ok"
        );

        fillSelect(
          $("quality"),
          data.levels,
          "Automática",
          (level, index) =>
            (level.height ? level.height + "p" : "Nível " + index) +
            (level.bitrate
              ? " · " + Math.round(level.bitrate / 1000) + " kbps"
              : "")
        );

        fillSelect(
          $("audio"),
          data.audioTracks,
          "Padrão",
          track => track.name || track.lang || "Áudio"
        );

        fillSelect(
          $("subtitles"),
          data.subtitleTracks,
          "Desativadas",
          track => track.name || track.lang || "Legenda"
        );
      },

      audioTracks(tracks) {
        fillSelect(
          $("audio"),
          tracks,
          "Padrão",
          track => track.name || track.lang || "Áudio"
        );
      },

      subtitleTracks(tracks) {
        fillSelect(
          $("subtitles"),
          tracks,
          "Desativadas",
          track => track.name || track.lang || "Legenda"
        );
      }
    });
  }

  async function resolverFonte(url) {
    /*
      Não fazemos fetch antes do HLS.js.
      Isso evita uma requisição extra que pode falhar por CORS.
      O carregamento será feito pelo motor HLS.
    */

    log("Utilizando diretamente a URL informada.");
    return url;
  }

  async function play(raw) {
    const value = (raw || "").trim();

    if (!value) {
      say("Informe uma URL M3U8.", "err");
      return;
    }

    let parsed;

    try {
      parsed = parseSource(value, "auto", location.protocol);
    } catch (error) {
      say(error.message || "URL inválida.", "err");
      log(error.message || "URL inválida.");
      return;
    }

    const thisRequest = ++requestId;

    currentUrl = parsed.url;
    $("url").value = currentUrl;

    $("log").textContent = "Iniciando player...";
    say("Preparando reprodução...");

    stop();

    if (!window.Artplayer) {
      say("Não foi possível carregar ArtPlayer.", "err");
      log("Verifique o CDN do ArtPlayer.");
      return;
    }

    if (!window.Hls) {
      say("Não foi possível carregar HLS.js.", "err");
      log("Verifique o CDN do HLS.js.");
      return;
    }

    const finalUrl = await resolverFonte(currentUrl);

    if (thisRequest !== requestId) return;

    log("Fonte utilizada: " + finalUrl);

    const customType = {
      m3u8(video, url) {
        engine = createEngine();
        engine.load(video, url);
      }
    };

    art = new Artplayer({
      container: $("player"),
      url: finalUrl,
      type: parsed.type === "video" ? "mp4" : "m3u8",
      customType,

      autoplay: embedMode,
      muted: embedMode,
      volume: 0.8,

      aspectRatio: true,
      autoSize: false,

      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      setting: true,

      playbackRate: true,
      theme: "#e8bd45",
      lang: "pt-br",

      moreVideoAttr: {
        crossorigin: "anonymous",
        playsInline: true
      },

      controls: [
        {
          name: "reload",
          position: "right",
          html: "↻",
          tooltip: "Recarregar",
          click: () => play(currentUrl)
        }
      ],

      contextmenu: [
        {
          name: "EdifesfPlayer",
          html: "EdifesfPlayer · HLS"
        }
      ]
    });

    art.on("ready", () => {
      say("Player pronto. Pressione Play para iniciar.", "ok");
      log("ArtPlayer inicializado.");

      if (embedMode) {
        tentarAutoplay();
      }
    });

    function tentarAutoplay() {
      if (!art || !embedMode) return;

      art.muted = true;

      const result = art.play();

      if (result && typeof result.catch === "function") {
        result.catch(error => {
          log("Autoplay bloqueado pelo navegador: " + error.message);
        });
      }
    }

    if (embedMode) {
      art.on("video:loadedmetadata", tentarAutoplay);
      art.on("video:canplay", tentarAutoplay);
    }

    art.on("error", error => {
      say("O player encontrou um erro. Consulte o diagnóstico.", "err");

      log(
        "ArtPlayer: " +
        (error && error.message ? error.message : String(error))
      );
    });

    art.on("video:playing", () => {
      say("Reproduzindo transmissão.", "ok");
    });

    art.on("video:waiting", () => {
      say("Aguardando dados da transmissão...");
    });

    art.on("video:ended", () => {
      say("Transmissão encerrada.");
    });
  }

  // BOTÕES

  $("play").addEventListener("click", () => {
    play($("url").value);
  });

  $("url").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      play($("url").value);
    }
  });

  $("reload").addEventListener("click", () => {
    if (currentUrl) play(currentUrl);
  });

  $("copy").addEventListener("click", async () => {
    if (!currentUrl) return;

    try {
      await navigator.clipboard.writeText(currentUrl);
      say("URL copiada.", "ok");
    } catch (_) {
      say("Não foi possível copiar a URL.", "err");
    }
  });

  $("open").addEventListener("click", () => {
    if (currentUrl) {
      window.open(currentUrl, "_blank", "noopener");
    }
  });

  // QUALIDADE

  $("quality").addEventListener("change", () => {
    if (engine) {
      engine.setQuality(Number($("quality").value));
    }
  });

  // ÁUDIO

  $("audio").addEventListener("change", () => {
    if (engine && $("audio").value !== "-1") {
      engine.setAudio(Number($("audio").value));
    }
  });

  // LEGENDAS

  $("subtitles").addEventListener("change", () => {
    if (engine) {
      engine.setSubtitle(Number($("subtitles").value));
    }
  });

  // VELOCIDADE

  $("speed").addEventListener("change", () => {
    if (art) {
      art.playbackRate = Number($("speed").value);
    }
  });

  // URL RECEBIDA POR PARÂMETRO

  const incoming = new URLSearchParams(location.search).get("url");

  if (incoming) {
    $("url").value = incoming;
    play(incoming);
  }

})();

