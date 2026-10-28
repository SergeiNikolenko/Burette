#!/usr/bin/env python3
"""Run with the locked renderer Python: ESP scale, density silhouette and stereo H."""
import unittest

import networkx as nx
import numpy as np
from xyzrender import render
from xyzrender.api import Molecule
from xyzrender.cube import BOHR_TO_ANG, CubeData
from xyzrender.dens import build_density_contours
from xyzrender.esp import build_esp_surface
from xyzrender.types import ESPParams


def gaussian_field():
    axis = (np.arange(28) - 13.5) * 0.5
    x, y, z = np.meshgrid(axis, axis, axis, indexing='ij')
    density = np.exp(-(x*x + y*y + z*z) / 4)

    def cube(values):
        return CubeData(atoms=[('H', (0, 0, 0))], origin=np.array([axis[0]] * 3),
                        steps=np.eye(3) * 0.5, grid_shape=values.shape, grid_data=values, mo_index=None)
    return cube(density), cube(x)


class UpstreamRenderingTests(unittest.TestCase):
    def test_esp_preserves_analytic_shell_potential(self):
        density, potential = gaussian_field()
        surface = build_esp_surface(density, potential, ESPParams(isovalue=0.1))
        radius = 2 * np.sqrt(np.log(10))
        # A field V=x has a known range on the spherical density shell. The
        # pre-fix projection diluted it by 20–30x with empty projected pixels.
        self.assertGreater(surface.esp_vmax, 0.5 * radius)
        self.assertLess(surface.esp_vmin, -0.5 * radius)
        self.assertLessEqual(surface.esp_vmax, 1.05 * radius)
        self.assertGreaterEqual(surface.esp_vmin, -1.05 * radius)

    def test_density_below_twenty_times_isovalue_still_has_visible_silhouette(self):
        density, _ = gaussian_field()
        surface = build_density_contours(density, isovalue=0.1, color='#2554A5')
        self.assertGreater(len(surface.lobes), 0)
        self.assertGreater(sum(len(loop) for lobe in surface.lobes for loop in lobe.loops), 20)

    def test_density_contours_preserve_units_when_field_and_isovalue_are_scaled(self):
        density, _ = gaussian_field()
        original = build_density_contours(density, isovalue=0.1, color='#2554A5')
        density.grid_data *= 3
        scaled = build_density_contours(density, isovalue=0.3, color='#2554A5')
        self.assertEqual(len(original.lobes), len(scaled.lobes))
        for left, right in zip(original.lobes, scaled.lobes):
            self.assertEqual(len(left.loops), len(right.loops))
            for a, b in zip(left.loops, right.loops):
                np.testing.assert_allclose(a, b, atol=1e-8)

    def test_spherical_density_has_one_closed_silhouette_at_multiple_orientations(self):
        density, _ = gaussian_field()
        diameter = 4 * np.sqrt(np.log(10)) * BOHR_TO_ANG
        for angle in (0, 0.31, 0.79):
            with self.subTest(angle=angle):
                c, s = np.cos(angle), np.sin(angle)
                rotation = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
                surface = build_density_contours(density, 0.1, '#2554A5', rot=rotation, n_layers=1)
                self.assertEqual(len(surface.lobes), 1)
                self.assertEqual(len(surface.lobes[0].loops), 1)
                loop = surface.lobes[0].loops[0]
                span = np.ptp(loop, axis=0) / (surface.resolution - 1)
                dimensions = span * [surface.y_max - surface.y_min, surface.x_max - surface.x_min]
                np.testing.assert_allclose(dimensions, diameter, rtol=0.15)

    def test_hydrogen_mode_keeps_stereochemistry_but_hides_nonessential_h(self):
        def circles(symbols, all_h):
            graph = nx.Graph()
            graph.add_node(0, symbol='C', position=(0, 0, 0))
            positions = [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]
            for i, (symbol, position) in enumerate(zip(symbols, positions), 1):
                graph.add_node(i, symbol=symbol, position=position)
                graph.add_edge(0, i, bond_order=1.0)
            svg = str(render(Molecule(graph), hy=True if all_h else None,
                             no_hy=not all_h, orient=False, gradient=False))
            return svg.count('<circle')
        stereo = ('H', 'F', 'Cl', 'Br')
        symmetric = ('H', 'F', 'F', 'Br')
        self.assertEqual(circles(stereo, False), circles(stereo, True))
        self.assertEqual(circles(symmetric, False) + 1, circles(symmetric, True))


if __name__ == '__main__':
    unittest.main()
