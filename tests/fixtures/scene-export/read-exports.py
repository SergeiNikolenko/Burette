"""Independent readers for the 3D model exports of tests/test-scene-export-readers.mjs.

The expected scene comes from the SDF fixture and published tables only: Bondi van
der Waals radii (J. Phys. Chem. 1964, 68, 441) and the Jmol CPK element colours.
Usage: read-exports.py <export directory> <ethanol.sdf>
"""
import json
import re
import shutil
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import plyfile
import trimesh

RADIUS = {"H": 1.10, "C": 1.70, "O": 1.52}
COLOR = {"H": (255, 255, 255), "C": (0x90, 0x90, 0x90), "O": (0xFF, 0x0D, 0x0D)}

directory, sdf = Path(sys.argv[1]), Path(sys.argv[2]).read_text().splitlines()
count = int(sdf[3][:3])
atoms = [(line[31:34].strip(), [float(line[0:10]), float(line[10:20]), float(line[20:30])]) for line in sdf[4 : 4 + count]]
centers = np.array([xyz for _, xyz in atoms])
radii = np.array([RADIUS[element] for element, _ in atoms])
colors = np.array([COLOR[element] for element, _ in atoms])
report = {}


def assign(points):
    """The atom whose drawn sphere each point lies on, and the distance from that sphere."""
    offset = np.abs(np.linalg.norm(points[:, None, :] - centers[None, :, :], axis=2) - radii[None, :])
    atom = offset.argmin(axis=1)
    return atom, offset[np.arange(len(points)), atom]


def check_scene(name, points, normals, rgb, faces, tolerance):
    atom, off = assign(points)
    assert off.max() < tolerance, f"{name}: a vertex lies {off.max():.4f} A off every atom sphere (hidden bonds exported?)"
    per_atom = np.bincount(atom, minlength=count)
    assert per_atom.min() > 0 and len(set(per_atom)) == 1, f"{name}: spheres per atom {per_atom}"
    true_min, true_max = (centers - radii[:, None]).min(axis=0), (centers + radii[:, None]).max(axis=0)
    low, high = points.min(axis=0), points.max(axis=0)
    assert np.all(low >= true_min - tolerance) and np.all(low <= true_min + 0.05), f"{name}: min {low} vs {true_min}"
    assert np.all(high <= true_max + tolerance) and np.all(high >= true_max - 0.05), f"{name}: max {high} vs {true_max}"
    if normals is not None:
        lengths = np.linalg.norm(normals, axis=1)
        assert np.abs(lengths - 1).max() < 1e-4, f"{name}: normal lengths {lengths.min()}..{lengths.max()}"
        radial = (points - centers[atom]) / np.linalg.norm(points - centers[atom], axis=1)[:, None]
        assert (normals * radial).sum(axis=1).min() > 0.99, f"{name}: a normal does not point out of its sphere"
        corners = points[faces]
        geometric = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
        assert ((geometric * normals[faces].mean(axis=1)).sum(axis=1) > 0).all(), f"{name}: a face winds against its normals"
    if rgb is not None:
        assert np.abs(rgb.astype(int) - colors[atom]).max() <= 1, f"{name}: a vertex is not its element colour"
    report[name] = {"vertices": int(len(points)), "faces": int(len(faces)), "maxSphereOffset": float(off.max()),
                    "min": [round(float(v), 4) for v in low], "max": [round(float(v), 4) for v in high]}


# PLY: plyfile reads the header and binary body; trimesh reads it once more.
ply_path = directory / "scene.ply"
ply = plyfile.PlyData.read(str(ply_path))
assert not ply.text and ply.byte_order == "<" and "Burette scene mesh; coordinates in angstrom" in ply.comments
vertex = ply["vertex"]
points = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1).astype(float)
normals = np.stack([vertex["nx"], vertex["ny"], vertex["nz"]], axis=1).astype(float)
rgba = np.stack([vertex["red"], vertex["green"], vertex["blue"], vertex["alpha"]], axis=1)
faces = np.stack(ply["face"]["vertex_indices"]).astype(int)
assert (rgba[:, 3] == 255).all()
check_scene("ply", points, normals, rgba[:, :3], faces, 2e-3)
mesh = trimesh.load(ply_path, process=False)
assert np.array_equal(mesh.faces, faces) and np.allclose(mesh.vertices, points)
assert np.array_equal(mesh.visual.vertex_colors, rgba)

# glTF binary: the container by hand, the mesh through trimesh.
glb_path = directory / "scene.glb"
raw = glb_path.read_bytes()
magic, version, length, json_length, json_type = struct.unpack_from("<4sIIII", raw)
assert magic == b"glTF" and version == 2 and length == len(raw) and json_type == 0x4E4F534A
gltf = json.loads(raw[20 : 20 + json_length])
position = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
assert np.allclose(position["min"], points.min(axis=0), atol=1e-6) and np.allclose(position["max"], points.max(axis=0), atol=1e-6)
assert gltf["materials"][0]["alphaMode"] == "OPAQUE" and gltf["extras"]["lengthUnit"] == "angstrom"
(glb,) = trimesh.load(glb_path, process=False).geometry.values()
srgb = colors / 255
linear = np.round(np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4) * 255)
atom, _ = assign(np.asarray(glb.vertices))
assert np.allclose(glb.vertices, points, atol=1e-6) and np.array_equal(glb.faces, faces)
assert np.abs(np.asarray(glb.visual.vertex_attributes["color"])[:, :3].astype(int) - linear[atom]).max() <= 1, "glb: COLOR_0 is not linear element colour"
check_scene("glb", np.asarray(glb.vertices), np.asarray(glb.vertex_normals), None, np.asarray(glb.faces), 2e-3)

# OBJ: trimesh reads vertex colours, normals and faces in file order.
obj = trimesh.load(directory / "scene.obj", process=False, maintain_order=True)
assert np.array_equal(obj.faces, faces)
check_scene("obj", np.asarray(obj.vertices), np.asarray(obj.vertex_normals), np.asarray(obj.visual.vertex_colors)[:, :3], np.asarray(obj.faces), 2e-3)

# X3D: XML with the declared unit, a viewpoint and one indexed triangle set.
root = ET.parse(directory / "scene.x3d").getroot()
assert root.tag == "X3D" and root.get("version") == "3.3"
unit = root.find("head/unit")
assert unit.get("category") == "length" and float(unit.get("conversionFactor")) == 1e-10
assert root.find("Scene/Viewpoint") is not None
ortho = ET.parse(directory / "scene-orthographic.x3d").getroot().find("Scene/OrthoViewpoint")
left, bottom, right, top = (float(v) for v in ortho.get("fieldOfView").split())
assert left == -right and bottom == -top and abs(right / top - 4 / 3) < 1e-3, "x3d: orthographic view keeps the viewport aspect"
triangles = root.find("Scene/Shape/IndexedTriangleSet")
numbers = lambda element, attribute: np.array(element.get(attribute).split(), dtype=float)
x3d_faces = numbers(triangles, "index").astype(int).reshape(-1, 3)
x3d_points = numbers(triangles.find("Coordinate"), "point").reshape(-1, 3)
x3d_normals = numbers(triangles.find("Normal"), "vector").reshape(-1, 3)
x3d_colors = numbers(triangles.find("ColorRGBA"), "color").reshape(-1, 4)
assert np.array_equal(x3d_faces, faces) and np.allclose(x3d_points, points, atol=1e-5)
assert np.abs(x3d_colors * 255 - rgba).max() < 0.6
check_scene("x3d", x3d_points, x3d_normals / np.linalg.norm(x3d_normals, axis=1)[:, None], np.round(x3d_colors[:, :3] * 255), x3d_faces, 2e-3)

# VRML 2.0: structure by hand; VTK's importer when it is installed.
wrl_path = directory / "scene.wrl"
wrl = wrl_path.read_text()
assert wrl.startswith("#VRML V2.0 utf8\n")
block = lambda name: re.search(name + r" \[\n(.*?)\]", wrl, re.S).group(1)
wrl_points = np.array(re.findall(r"[-\d.e]+", block("point")), dtype=float).reshape(-1, 3)
wrl_faces = np.array(re.findall(r"-?\d+", block("coordIndex")), dtype=int).reshape(-1, 4)
assert (wrl_faces[:, 3] == -1).all() and np.array_equal(wrl_faces[:, :3], faces) and np.allclose(wrl_points, points, atol=1e-5)
report["wrl"] = {"vertices": len(wrl_points), "faces": len(wrl_faces)}
try:
    import vtk

    importer = vtk.vtkVRMLImporter()
    importer.SetFileName(str(wrl_path))
    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(1)
    importer.SetRenderWindow(window)
    # VTK 9 renamed Read to Update.
    (importer.Update if hasattr(importer, "Update") else importer.Read)()
    actors = importer.GetRenderer().GetActors()
    actors.InitTraversal()
    polydata = actors.GetNextActor().GetMapper().GetInput()
    assert polydata.GetNumberOfPoints() == len(points) and polydata.GetNumberOfCells() == len(faces)
    report["wrl"]["vtk"] = {"points": polydata.GetNumberOfPoints(), "cells": polydata.GetNumberOfCells()}
except ImportError:
    report["wrl"]["vtk"] = "not installed"

# POV-Ray: structure by hand; a render when POV-Ray is installed.
pov_path = directory / "scene.pov"
pov = pov_path.read_text()
counted = lambda name: int(re.search(name + r" \{ (\d+),", pov).group(1))
assert counted("vertex_vectors") == len(points) and counted("normal_vectors") == len(points) and counted("face_indices") == len(faces)
assert counted("texture_list") == 3, "one texture per drawn element colour"
report["pov"] = {"vertices": counted("vertex_vectors"), "faces": counted("face_indices"), "textures": counted("texture_list")}
if shutil.which("povray"):
    from PIL import Image

    report["pov"]["render"] = {}
    for scene in ("scene", "scene-orthographic"):
        image_path = directory / f"{scene}-pov.png"
        run = subprocess.run(["povray", f"+I{directory / (scene + '.pov')}", f"+O{image_path}", "+W320", "+H240", "-D", "+FN", "-GA"], capture_output=True, text=True)
        assert run.returncode == 0, run.stderr[-2000:]
        pixels = np.asarray(Image.open(image_path).convert("RGB")).astype(int)
        drawn = np.argwhere((pixels != 255).any(axis=2))
        red = np.argwhere((pixels[:, :, 0] > 120) & (pixels[:, :, 1] < 60) & (pixels[:, :, 2] < 60))
        # The camera looks at the molecule's centre; oxygen (+x) appears right of it.
        centre = drawn.mean(axis=0)
        assert abs(centre[1] - 160) < 40 and abs(centre[0] - 120) < 40, f"{scene}.pov: scene centred at {centre}"
        assert len(red) and red[:, 1].mean() > centre[1], f"{scene}.pov: oxygen is not on the +x side of the image"
        report["pov"]["render"][scene] = {"drawnPixels": int(len(drawn)), "oxygenPixels": int(len(red)), "oxygenColumn": round(float(red[:, 1].mean()), 1)}
else:
    report["pov"]["render"] = "povray not installed"

print(json.dumps(report, indent=1))
