from pathlib import Path

BASE = Path(__file__).resolve().parent
ARQUIVO_ENTRADA = BASE / "youtube.txt"
ARQUIVO_SAIDA = BASE / "youtube.m3u"


def gerar_playlist():
    if not ARQUIVO_ENTRADA.exists():
        raise FileNotFoundError("Crie o arquivo youtube.txt primeiro.")

    linhas = ["#EXTM3U"]
    total = 0

    for linha in ARQUIVO_ENTRADA.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            continue

        partes = [parte.strip() for parte in linha.split("|")]
        if len(partes) >= 5:
            # Tema|Categoria|Classificação|Episódio/Título|URL
            nome = partes[3] or f"YouTube {total + 1}"
            url = "|".join(partes[4:]).strip()
        elif len(partes) >= 3:
            # Formato antigo: Tema|Título|URL
            nome = partes[1] or f"YouTube {total + 1}"
            url = "|".join(partes[2:]).strip()
        elif len(partes) == 2:
            nome, url = partes
        else:
            nome, url = f"YouTube {total + 1}", partes[0]

        if not url.startswith("https://"):
            print(f"Link ignorado: {url}")
            continue

        linhas.append(f"#EXTINF:-1,{nome}")
        linhas.append(url)
        total += 1

    ARQUIVO_SAIDA.write_text("\\n".join(linhas) + "\\n", encoding="utf-8")
    print(f"Playlist criada: {ARQUIVO_SAIDA}")
    print(f"Entradas: {total}")


if __name__ == "__main__":
    gerar_playlist()
