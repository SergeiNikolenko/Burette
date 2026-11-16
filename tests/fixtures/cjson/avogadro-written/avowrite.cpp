// Writes Chemical JSON with Avogadro's own writer (avogadrolibs cb0e9485).
//   avowrite molden IN.molden OUT.cjson
//   avowrite vib IN.txt OUT.cjson   (sets and per-conformer modes from vib.py)
#include <avogadro/core/molecule.h>
#include <avogadro/core/elements.h>
#include <avogadro/io/cjsonformat.h>
#include <avogadro/quantumio/molden.h>
#include <fstream>
#include <iostream>
#include <string>
using namespace Avogadro;
int main(int argc, char** argv) {
  if (argc != 4) return 2;
  std::string mode = argv[1];
  Core::Molecule molecule;
  if (mode == "molden") {
    QuantumIO::MoldenFile reader;
    if (!reader.readFile(argv[2], molecule)) { std::cerr << reader.error() << "\n"; return 1; }
  } else {
    std::ifstream in(argv[2]);
    size_t atoms, sets; in >> atoms >> sets;
    std::vector<std::string> symbols(atoms);
    for (auto& s : symbols) in >> s;
    for (size_t set = 0; set < sets; ++set) {
      Core::Array<Vector3> coords(atoms);
      for (auto& c : coords) in >> c[0] >> c[1] >> c[2];
      if (set == 0) for (size_t a = 0; a < atoms; ++a) molecule.addAtom(Core::Elements::atomicNumberFromSymbol(symbols[a])).setPosition3d(coords[a]);
      molecule.setCoordinate3d(coords, set);
    }
    molecule.perceiveBondsSimple();
    size_t blocks; in >> blocks;
    for (size_t b = 0; b < blocks; ++b) {
      size_t conformer, modes; in >> conformer >> modes;
      Core::Array<double> freqs(modes), ir(modes);
      for (auto& f : freqs) in >> f;
      for (auto& i : ir) in >> i;
      Core::Array<Core::Array<Vector3>> lx(modes, Core::Array<Vector3>(atoms));
      for (auto& m : lx) for (auto& v : m) in >> v[0] >> v[1] >> v[2];
      molecule.setVibrationFrequencies(freqs, conformer);
      molecule.setVibrationIRIntensities(ir, conformer);
      molecule.setVibrationLx(lx, conformer);
    }
    molecule.setCoordinate3d(static_cast<int>(sets - 1));
  }
  Io::CjsonFormat writer;
  if (!writer.writeFile(argv[3], molecule)) { std::cerr << writer.error() << "\n"; return 1; }
  return 0;
}
