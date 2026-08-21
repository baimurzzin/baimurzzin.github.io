.PHONY: all site cv serve clean

all: cv site

# Render content.toml → index.html (en), ru/index.html, kk/index.html.
site:
	python3 build.py

# Build the one-page PDFs from cv/cv-{en,ru,kk}.tex. Uses tectonic
# (self-contained, downloads what it needs); falls back to latexmk otherwise.
# Both engines must be Unicode-aware (XeTeX) for the ru/kk files.
cv:
	@for lang in en ru kk; do \
		if command -v tectonic >/dev/null 2>&1; then \
			(cd cv && tectonic cv-$$lang.tex); \
		else \
			(cd cv && latexmk -xelatex -interaction=nonstopmode cv-$$lang.tex && latexmk -c); \
		fi; \
	done

serve: all
	python3 -m http.server 8000

clean:
	rm -f cv/*.aux cv/*.log cv/*.out cv/*.fls cv/*.fdb_latexmk
