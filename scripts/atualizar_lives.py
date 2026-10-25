
import json
import re
import subprocess
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ARQUIVO_CANAIS = BASE / "canais.txt"
ARQUIVO_LISTA = BASE / "youtube.txt"

PADROES_CLIENTE = [
    "tv,web_safari",
    "web_safari,tv",
    "default,-android_sdkless",
]


def identificar_canal(nome):
    """Identifica somente nomes exatos de canais configurados."""
    n = re.sub(r"\s+", " ", nome.casefold()).strip()

    canais = {
        "cnn brasil": "cnn",
        "bandnews": "bandnews",
        "band news": "bandnews",
        "sbt news": "sbt",
        "record news": "record",
        "jovem pan": "jovem",
        "bandjornal": "bandjornal",
        "band jornal": "bandjornal",
        "novo tempo": "tvnovotempo",
        "tv novo tempo": "tvnovotempo",
    }

    return canais.get(n)


def ler_canais():
    canais = {}

    for linha in ARQUIVO_CANAIS.read_text(
        encoding="utf-8-sig"
    ).splitlines():
        if not linha.strip() or "|" not in linha:
            continue

        nome, url = linha.split("|", 1)
        chave = identificar_canal(nome)

        if chave and url.strip().startswith("https://"):
            canais[chave] = url.strip()

    return canais


def obter_live(url):
    """Retorna somente um vídeo identificado como live ativa."""

    for cliente in PADROES_CLIENTE:
        comando = [
            "yt-dlp",
            "--dump-single-json",
            "--no-warnings",
            "--no-playlist",
            "--extractor-args",
            f"youtube:player_client={cliente}",
            url,
        ]

        print(f"Tentando cliente {cliente}: {url}")

        try:
            proc = subprocess.run(
                comando,
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )

            if proc.returncode != 0 or not proc.stdout.strip():
                erro = proc.stderr.strip()

                if (
                    "Sign in to confirm" in erro
                    or "confirm you're not a bot" in erro.lower()
                ):
                    print("YouTube exige confirmação contra bots.")
                elif erro:
                    print(f"Falha de consulta: {erro[-300:]}")

                time.sleep(2)
                continue

            dados = json.loads(proc.stdout)
            entradas = dados.get("entries")
            candidatos = entradas if entradas else [dados]

            for item in candidatos:
                if not isinstance(item, dict):
                    continue

                ativo = (
                    item.get("is_live") is True
                    or item.get("live_status") == "is_live"
                )

                video_id = item.get("id", "")

                if (
                    ativo
                    and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id)
                ):
                    print(f"Live identificada: {video_id}")
                    return (
                        "https://www.youtube.com/watch?v=" + video_id
                    )

            print("Nenhuma live ativa identificada nesta tentativa.")

        except subprocess.TimeoutExpired:
            print(f"Tempo esgotado: {url}")
        except (json.JSONDecodeError, OSError) as erro:
            print(f"Erro na consulta: {erro}")

        time.sleep(2)

    print(f"Consulta indisponível após as tentativas: {url}")
    return None


def main():
    if not ARQUIVO_CANAIS.exists():
        raise FileNotFoundError("canais.txt não foi encontrado.")

    if not ARQUIVO_LISTA.exists():
        raise FileNotFoundError("youtube.txt não existe.")

    fontes = ler_canais()

    if not fontes:
        raise RuntimeError("Nenhum canal válido em canais.txt.")

    lives = {}

    for chave, url in fontes.items():
        print(f"\nConsultando {chave}: {url}")
        lives[chave] = obter_live(url)

    texto = ARQUIVO_LISTA.read_text(encoding="utf-8-sig")
    linhas = texto.splitlines()
    resultado = []
    alteracoes = 0
    canais_encontrados = set()

    for linha in linhas:
        if not linha.strip() or linha.lstrip().startswith("#"):
            resultado.append(linha)
            continue

        partes = linha.split("|")

        # Formato obrigatório:
        # Tema|Categoria|Classificação|Título|URL
        if len(partes) != 5:
            resultado.append(linha)
            continue

        categoria = partes[1].strip()
        classificacao = partes[2].strip()
        nome = partes[3].strip()
        url_atual = partes[4].strip()

        # Somente transmissões ao vivo da categoria Notícias.
        if categoria.casefold() != "live":
            resultado.append(linha)
            continue

        if classificacao.casefold() != "notícias":
            resultado.append(linha)
            continue

        # Não modificar links que não sejam do YouTube.
        if not re.match(
            r"^https?://(www\.)?(youtube\.com|youtu\.be)/",
            url_atual,
            re.IGNORECASE,
        ):
            resultado.append(linha)
            continue

        # Correspondência exata: "Record News 2" não é "Record News".
        chave = identificar_canal(nome)

        if not chave or chave not in lives:
            resultado.append(linha)
            continue

        nova_url = lives[chave]

        if not nova_url:
            print(
                f"Preservado: {nome} — "
                "não foi possível confirmar uma live ativa."
            )
            resultado.append(linha)
            continue

        canais_encontrados.add(chave)

        if url_atual != nova_url:
            partes[4] = nova_url
            linha = "|".join(partes)
            alteracoes += 1
            print(f"Atualizado: {nome} -> {nova_url}")
        else:
            print(f"Já atualizado: {nome}")

        resultado.append(linha)

    for chave, url in lives.items():
        if url and chave not in canais_encontrados:
            print(
                f"ATENÇÃO: live identificada para '{chave}', "
                "mas nenhuma linha correspondente válida "
                "foi encontrada em youtube.txt."
            )

    novo_texto = "\n".join(resultado)

    if texto.endswith("\n"):
        novo_texto += "\n"

    if novo_texto != texto:
        ARQUIVO_LISTA.write_text(novo_texto, encoding="utf-8")
        print(f"\nConcluído: {alteracoes} URL(s) alterada(s).")
    else:
        print("\nNenhuma alteração necessária.")
        print("As linhas existentes foram preservadas.")


if __name__ == "__main__":
    main()
