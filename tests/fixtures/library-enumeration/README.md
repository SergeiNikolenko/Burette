# Library enumeration fixtures

Building blocks and reference products for `tests/test-library-enumeration.test.ts`
(Stage 25, Enumerate Library). The building blocks are common reagents written
by hand for this test; nothing here comes from a third-party data set.

| File | Contents | SHA-256 |
| --- | --- | --- |
| `acids.smi` | 3 carboxylic acids (SMILES and name per line) | `94555db693fd9fe0e8e2497c8518df88ed023a7fd330946fcafe04a00a903af8` |
| `amines.smi` | 4 amines | `6b6fb2cb1337a2979e22d31334564123abe18cc8d4ccc340f1d3b754723c7913` |
| `r1.smi` | 2 groups for R1, attachment point written `*` | `dfb9212462fb5c409af6dd6f802de4d8c4e994f5b9a59a2491719f202af31c7c` |
| `r2.smi` | 3 groups for R2 | `f9b2e78b641dd69d2d9c166a84842529c6b6a653c37885e9d97adf31f0352801` |
| `reference.py` | The script that produces `expected.json` | `edca1fe568ab23b21d29667ffbe76697816d95ef2029dedf5e7d13b490b05f90` |
| `expected.json` | Its output with RDKit 2026.09.2 | `82b0fc45d453b08ce8ab8d07b7c662e13ea3882c9de590c92e5eb00bcc657289` |

## Reference

```sh
cd tests/fixtures/library-enumeration
uv run --with rdkit python reference.py > expected.json
```

`reference.py` builds two libraries with RDKit:

- **Amides, 3 x 4.** `AllChem.EnumerateLibraryFromReaction` over `acids.smi` and
  `amines.smi` with the amide-coupling SMARTS the app offers as *Amidation*:
  `[C:1](=[O:2])[OH].[N;!$(N=*);!$(N-[!#6;!#1]);!$(N-C=[O,N,S]):3]>>[C:1](=[O:2])[N:3]`.
  It gives 12 products; each is recorded as canonical SMILES with the acid and
  the amine (SMILES and 1-based row) it came from.
- **Core, 2 x 3.** The core `[*:1]c1ccc([*:2])cc1` joined with every pair from
  `r1.smi` and `r2.smi` by two `Chem.molzip` calls, after the attachment point of
  each group is given the atom map number of its position. It gives 6 products.

The first `molzip` of each pair leaves `[*:2]` open, so RDKit prints
`Incomplete atom labelling, cannot make bond` on stderr six times. That is
expected; the second call closes the position.

The products, in the order RDKit yields them:

```text
amides                         acid row  amine row
CCNC(C)=O                      1         1
CC(=O)Nc1ccccc1                1         2
CC(=O)N1CCOCC1                 1         3
CC(=O)NCc1ccccc1               1         4
CCNC(=O)c1ccccc1               2         1
O=C(Nc1ccccc1)c1ccccc1         2         2
O=C(c1ccccc1)N1CCOCC1          2         3
O=C(NCc1ccccc1)c1ccccc1        2         4
CCNC(=O)C1CC1                  3         1
O=C(Nc1ccccc1)C1CC1            3         2
O=C(C1CC1)N1CCOCC1             3         3
O=C(NCc1ccccc1)C1CC1           3         4

core library                   R1        R2
Cc1ccc(O)cc1                   *C        *O
Cc1ccc(N)cc1                   *C        *N
Cc1ccc(C(F)(F)F)cc1            *C        *C(F)(F)F
Oc1ccc(Cl)cc1                  *Cl       *O
Nc1ccc(Cl)cc1                  *Cl       *N
FC(F)(F)c1ccc(Cl)cc1           *Cl       *C(F)(F)F
```

The test compares these strings with the app's products directly: the RDKit
WASM build the app ships (2026.03.6) writes the same canonical SMILES.
