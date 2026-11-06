"""Test fixture for the Avogadro script energy protocol (text-v1 and binary-v1).

E = sum over atoms of |r|^2 + charge (kJ/mol), gradient 2r (kJ/(mol*A)).
The binary protocol also answers batch requests (energies of many coordinate
sets at once). A coordinate beyond 1000 A is refused: binary-v1 answers with an error frame,
text-v1 prints a message on stderr and exits. Standard library only.

    harmonic_energy.py <identifier> [--protocol binary-v1] --lang <locale>
"""

import json
import struct
import sys

HEADER = struct.Struct("<4sHHII")
FLAG_ERROR = 0x8000
FLAG_ENERGY_AND_GRADIENT = 0x0004
FLAG_BATCH = 0x0002


def energy_and_gradient(coords, charge):
    energy = charge + sum(x * x + y * y + z * z for x, y, z in coords)
    return energy, [2 * v for point in coords for v in point]


def atom_count(bootstrap):
    if "xyz" in bootstrap:
        return int(bootstrap["xyz"].split("\n", 1)[0])
    return len(bootstrap["cjson"]["atoms"]["elements"]["number"])


def read_exact(stream, count):
    data = b""
    while len(data) < count:
        chunk = stream.read(count - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def serve_binary(atoms, charge):
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    while True:
        header = read_exact(stdin, HEADER.size)
        if header is None:
            return
        magic, version, flags, count, size = HEADER.unpack(header)
        payload = read_exact(stdin, size)
        if flags & FLAG_BATCH:
            sets = struct.unpack("<I", payload[:4])[0]
            values = struct.unpack("<%dd" % ((size - 4) // 8), payload[4:])
            frames = [values[i:i + 3 * atoms] for i in range(0, len(values), 3 * atoms)]
            energies = [energy_and_gradient([f[i:i + 3] for i in range(0, len(f), 3)], charge)[0] for f in frames]
            body = struct.pack("<I%dd" % sets, sets, *energies)
            stdout.write(HEADER.pack(b"AVB1", 1, FLAG_BATCH, atoms, len(body)) + body)
            stdout.flush()
            continue
        values = struct.unpack("<%dd" % (size // 8), payload)
        coords = [values[i:i + 3] for i in range(0, len(values), 3)]
        if magic != b"AVB1" or count != atoms or any(abs(v) > 1000 for v in values):
            message = b"coordinates out of range"
            stdout.write(HEADER.pack(b"AVB1", 1, FLAG_ERROR, atoms, len(message)) + message)
        else:
            energy, gradient = energy_and_gradient(coords, charge)
            if flags & FLAG_ENERGY_AND_GRADIENT:
                payload = struct.pack("<%dd" % (1 + len(gradient)), energy, *gradient)
                stdout.write(HEADER.pack(b"AVB1", 1, FLAG_ENERGY_AND_GRADIENT, atoms, len(payload)) + payload)
            else:
                stdout.write(HEADER.pack(b"AVB1", 1, 0, atoms, 8) + struct.pack("<d", energy))
        stdout.flush()


def serve_text(atoms, charge):
    while True:
        coords = []
        for _ in range(atoms):
            line = sys.stdin.readline()
            if not line:
                return
            coords.append(tuple(float(v) for v in line.split()))
        if any(abs(v) > 1000 for point in coords for v in point):
            print("coordinates out of range", file=sys.stderr, flush=True)
            sys.exit(2)
        energy, gradient = energy_and_gradient(coords, charge)
        print("debug: evaluating")
        print("AvogadroEnergy:", repr(energy))
        print("AvogadroGradient:")
        for i in range(0, len(gradient), 3):
            print(" %r %r %r" % tuple(gradient[i:i + 3]))
        sys.stdout.flush()


def main():
    args = sys.argv[1:]
    binary = "--protocol" in args and args[args.index("--protocol") + 1].startswith("binary")
    # Text-mode readline reads ahead, as in avogadro-xtb-energy: a frame sent
    # before this line is read would be lost to the binary reader.
    bootstrap = json.loads(sys.stdin.readline())
    atoms, charge = atom_count(bootstrap), bootstrap.get("charge", 0)
    (serve_binary if binary else serve_text)(atoms, charge)


if __name__ == "__main__":
    main()
