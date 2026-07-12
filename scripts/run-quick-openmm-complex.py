#!/usr/bin/env python3
"""Run a short implicit-solvent OpenMM trajectory for a standard-residue complex."""

from __future__ import annotations

import argparse
from pathlib import Path

from openmm import LangevinMiddleIntegrator, Platform, unit
from openmm.app import DCDReporter, ForceField, HBonds, NoCutoff, PDBFile, Simulation
from pdbfixer import PDBFixer


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--steps", type=int, default=10000)
    parser.add_argument("--frames", type=int, default=100)
    parser.add_argument("--temperature", type=float, default=300.0)
    return parser.parse_args()


def main():
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fixer = PDBFixer(filename=str(args.input))
    fixer.findMissingResidues()
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()
    fixer.addMissingHydrogens(7.0)
    forcefield = ForceField("amber14-all.xml", "implicit/obc2.xml")
    system = forcefield.createSystem(fixer.topology, nonbondedMethod=NoCutoff, constraints=HBonds)
    integrator = LangevinMiddleIntegrator(
        args.temperature * unit.kelvin,
        1.0 / unit.picosecond,
        0.002 * unit.picoseconds,
    )
    simulation = Simulation(fixer.topology, system, integrator, Platform.getPlatformByName("CPU"))
    simulation.context.setPositions(fixer.positions)
    simulation.minimizeEnergy(maxIterations=500)
    simulation.context.setVelocitiesToTemperature(args.temperature * unit.kelvin, 20260712)
    simulation.step(1000)
    topology_path = args.output_dir / "1rlp-md.pdb"
    trajectory_path = args.output_dir / "1rlp-md.dcd"
    state = simulation.context.getState(getPositions=True)
    with topology_path.open("w", encoding="utf-8") as handle:
        PDBFile.writeFile(fixer.topology, state.getPositions(), handle, keepIds=True)
    interval = max(1, args.steps // max(2, args.frames))
    simulation.reporters.append(DCDReporter(str(trajectory_path), interval))
    simulation.step(args.steps)
    print(f"Wrote {args.steps * 0.002:.1f} ps to {trajectory_path} ({args.steps // interval} frames)")


if __name__ == "__main__":
    main()
