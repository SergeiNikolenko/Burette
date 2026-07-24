"""Read the energy series next to this script and report its drift."""

from pathlib import Path

HERE = Path(__file__).parent


def read_xvg(path):
    times, values = [], []
    for line in path.read_text().splitlines():
        if not line or line[0] in "#@":
            continue
        time, value = line.split()[:2]
        times.append(float(time))
        values.append(float(value))
    return times, values


def main():
    times, values = read_xvg(HERE / "energy.xvg")
    drift = (values[-1] - values[0]) / (times[-1] - times[0])
    print(f"frames: {len(values)}")
    print(f"mean:   {sum(values) / len(values):.2f} kJ/mol")
    print(f"drift:  {drift:.2f} kJ/mol/ps")


if __name__ == "__main__":
    main()
