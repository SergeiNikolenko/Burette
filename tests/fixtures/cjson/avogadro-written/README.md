# Avogadro-written CJSON fixtures

`avogadro-ch2-triplet-uhf.cjson` and `avogadro-water-hessians.cjson` are written
by Avogadro's own Chemical JSON writer at avogadrolibs `cb0e9485`, the revision
Burette pins. That revision is newer than the `avogadro` 2.1.0 wheel on PyPI,
and it is the first to write per-conformer vibrations.

Regenerate them on a Linux host:

```sh
git clone https://github.com/OpenChemistry/avogadrolibs && git -C avogadrolibs checkout cb0e9485
# Eigen 3.4 installed with CMake into eigen-install/
cmake -G Ninja -S avogadrolibs -B avo-build -DCMAKE_BUILD_TYPE=Release \
  -DEigen3_DIR=$PWD/eigen-install/share/eigen3/cmake -DUSE_QT=OFF -DUSE_PYTHON=OFF \
  -DENABLE_TESTING=OFF -DUSE_OPENGL=OFF -DUSE_HDF5=OFF -DUSE_MMTF=OFF -DUSE_SPGLIB=OFF \
  -DUSE_LIBARCHIVE=OFF -DUSE_LIBMSYM=OFF -DBUILD_DOCUMENTATION=OFF
cmake --build avo-build --target IO QuantumIO
g++ -std=c++17 -O1 -o avowrite avowrite.cpp -Iavogadrolibs -Iavogadrolibs/avogadro \
  -Iavo-build -Iavo-build/avogadro -Iavogadrolibs/thirdparty -Ieigen-install/include/eigen3 \
  -Lavo-build/lib -lAvogadroQuantumIO -lAvogadroIO -lAvogadroCore -Wl,-rpath,$PWD/avo-build/lib
python uhf.py && ./avowrite molden ch2-triplet-uhf.molden avogadro-ch2-triplet-uhf.cjson
python vib.py && ./avowrite vib water-vib.txt avogadro-water-hessians.cjson   # needs pyscf, geometric
```

What the writer does with these inputs, and the tests rely on:

- The Molden reader keeps no spin multiplicity or occupations, so the triplet
  is written with `totalSpinMultiplicity` 1 and no `alphaOccupations`.
- `betaCoefficients` repeats the alpha matrix (the writer copies `moMatrix()`
  for both spins), while `betaEnergies` are the true beta energies.
- Vibrations of the active set (3) are the flat keys, and `conformers` holds
  sets 0 and 3; sets 1 and 2 have none.
