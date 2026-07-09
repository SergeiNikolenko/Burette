SoftwareX LaTeX source package for:

Burrete: Local-first molecular file inspection for macOS, Quick Look, and
agent workflows

Main file: softwarex-submission.tex
Bibliography: softwarex.bib
Figures: figures/Figure_1_architecture.pdf and Figure_2--Figure_4 PNG files

The manuscript uses the standard Elsevier elsarticle class and the
elsarticle-num bibliography style.

Example build:

latexmk -pdf -interaction=nonstopmode -halt-on-error softwarex-submission.tex

The Graphviz source for the deterministic architecture diagram is included as
figures/burrete-architecture.dot. The PNG rendering is included for inspection;
the manuscript itself uses the vector PDF.
