# IDEAV Quintet arXiv Draft

This directory contains a publication-oriented draft for issue #3045.

Files:

- `ideav-quintet-en.tex` - English arXiv-style article.
- `ideav-quintet-ru.tex` - Russian arXiv-style article.
- `references.bib` - shared BibTeX references.

The draft is intentionally conservative about empirical claims. Public
patents and repository documentation support the formal storage and compiler
description, while performance results are framed as a benchmark protocol and
future controlled validation unless measured data are available for release.

To build locally from this directory:

```bash
pdflatex -interaction=nonstopmode ideav-quintet-en.tex
bibtex ideav-quintet-en
pdflatex -interaction=nonstopmode ideav-quintet-en.tex
pdflatex -interaction=nonstopmode ideav-quintet-en.tex
```

The Russian source may require a TeX distribution with Cyrillic support
(`babel` Russian language files and T2A fonts).
