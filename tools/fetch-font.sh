#!/bin/sh
# Re-download the self-hosted default font (Press Start 2P, OFL 1.1) from
# Google Fonts and regenerate fonts/press-start-2p.css. Only needed if the
# upstream font is updated — the files are committed to the repo.
set -e
cd "$(dirname "$0")/.."
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
python3 - "$UA" <<'PY'
import re, subprocess, sys, pathlib
ua = sys.argv[1]
css = subprocess.run(["curl","-sS","-A",ua,
    "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"],
    capture_output=True, text=True).stdout
out = ["/* Press Start 2P — self-hosted so the default font needs no third party.",
       "   SIL Open Font License 1.1. Regenerate with tools/fetch-font.sh */", ""]
for name, body in re.findall(r"/\* (\S+) \*/\s*@font-face \{(.*?)\}", css, re.S):
    url = re.search(r"url\((https://[^)]+)\)", body).group(1)
    rng = re.search(r"unicode-range: ([^;]+);", body)
    fn = f"press-start-2p-{name}.woff2"
    subprocess.run(["curl","-sS","-A",ua,url,"-o",f"fonts/{fn}"], check=True)
    out += ["@font-face {", "  font-family: 'Press Start 2P';",
            "  font-style: normal;", "  font-weight: 400;", "  font-display: swap;",
            f"  src: url({fn}) format('woff2');"]
    if rng: out.append(f"  unicode-range: {rng.group(1).strip()};")
    out += ["}", ""]
pathlib.Path("fonts/press-start-2p.css").write_text("\n".join(out))
PY
