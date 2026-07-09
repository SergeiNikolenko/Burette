# Citation audit

Audit date: 10 July 2026

## Summary

| Metric | Result |
| --- | ---: |
| Bibliography entries | 19 |
| Orphan in-text citations | 0 |
| Orphan bibliography entries | 0 |
| DOI-bearing entries | 14 |
| Official project/documentation URLs without DOI | 5 |
| Self-citations | 1 (5.3%) |

## Verification

- DOI syntax was normalized in BibTeX and every DOI resolved through Crossref
  or DataCite metadata.
- Bibliographic titles and years were compared with the deposited metadata.
- No retraction notice was present in the retrieved Crossref or DataCite
  records. Crossref reports a new_version relation for the OpenMM 7 article;
  this is not a retraction.
- PyMOL, Jmol, Apple Quick Look, and Tauri references use their official
  project or documentation pages.
- The Burrete software reference points to the immutable
  softwarex-v1.0.22 publication-snapshot tag.
- Older references describe foundational tools (VMD, Coot, Avogadro, Open
  Babel, Ketcher, 3Dmol.js, and VESTA) and are retained for historical and
  comparative relevance.

## Corrections made

1. Added a versioned Burrete software citation instead of relying only on an
   unversioned repository URL.
2. Updated web-reference access dates to the audit date.
3. Kept DOI values in canonical form and removed duplicate DOI URL fields from
   the generated Elsevier numeric bibliography.
4. Confirmed that every integrated tool named as an implementation component
   is either cited to a scholarly article, a versioned archive, or an official
   project page.
