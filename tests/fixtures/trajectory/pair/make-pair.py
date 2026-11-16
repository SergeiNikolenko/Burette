"""A 12-atom PDB with 30-frame XTC and DCD trajectories (MDAnalysis 2.11.0 writers),
and the distance between atoms 1 and 10 in every frame as MDAnalysis reads each file back."""
from pathlib import Path
import sys
import numpy as np
import MDAnalysis as mda
from MDAnalysis.lib.distances import calc_bonds

folder = Path(sys.argv[1])
rng = np.random.default_rng(20261106)
n, frames = 12, 30
u = mda.Universe.empty(n, n_residues=1, atom_resindex=[0] * n, trajectory=True)
elements = ["C", "C", "O", "N", "C", "C", "C", "O", "N", "C", "S", "C"]
u.add_TopologyAttr("names", [f"{e}{i + 1}" for i, e in enumerate(elements)])
u.add_TopologyAttr("elements", elements)
u.add_TopologyAttr("types", elements)
u.add_TopologyAttr("resnames", ["LIG"])
u.add_TopologyAttr("resids", [1])
base = np.array([[1.4 * i, 1.2 * np.sin(i), 0.8 * np.cos(1.3 * i)] for i in range(n)], dtype=np.float32) + 10
u.atoms.positions = base
u.dimensions = [30, 30, 30, 90, 90, 90]
u.atoms.write(folder / "pair.pdb")
walk = base.copy()
with mda.Writer(str(folder / "pair.xtc"), n) as xtc, mda.Writer(str(folder / "pair.dcd"), n, dt=2.0) as dcd:
    for frame in range(frames):
        walk = walk + rng.normal(0, 0.25, walk.shape).astype(np.float32)
        u.atoms.positions = walk
        u.trajectory.ts.time = 2.0 * frame
        u.dimensions = [30 + 0.1 * frame, 31, 32, 90, 90, 90]
        xtc.write(u.atoms)
        dcd.write(u.atoms)
rows = ["frame,time_ps,xtc_distance_A,dcd_distance_A"]
xtc = mda.Universe(str(folder / "pair.pdb"), str(folder / "pair.xtc"))
dcd = mda.Universe(str(folder / "pair.pdb"), str(folder / "pair.dcd"))
for a, b in zip(xtc.trajectory, dcd.trajectory):
    d1 = calc_bonds(xtc.atoms[0].position, xtc.atoms[9].position)
    d2 = calc_bonds(dcd.atoms[0].position, dcd.atoms[9].position)
    rows.append(f"{a.frame + 1},{a.time:.3f},{d1:.6f},{d2:.6f}")
(folder / "pair-distance-1-10.csv").write_text("\n".join(rows) + "\n")
print(rows[:3], len(rows) - 1, mda.__version__)
