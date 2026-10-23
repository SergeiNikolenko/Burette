# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.26"]
# ///
"""Synthesize the sound of Burette's first-launch atom opening.

Run with `uv run scripts/create_intro_sound.py` on macOS. The cues follow the
opening's timeline in apps/desktop/src/components/onboarding/intro/atom-scene.ts:
the nucleus swells in, three electrons launch and draw their orbits, the atom
flashes and blooms into the window, and the title lands. Everything sits in
E major so the layers stay consonant; the output is encoded to AAC with
afconvert and is deterministic for a given seed.
"""

from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np

RATE = 48_000
LENGTH = 9.0
SEED = 1033
OUTPUT = Path(__file__).resolve().parents[1] / "apps/desktop/public/onboarding/intro/atom-intro.m4a"

t = np.arange(round(RATE * LENGTH)) / RATE
rng = np.random.default_rng(SEED)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def envelope(start, attack, release, end):
    return smooth((t - start) / attack) * (1 - smooth((t - release) / (end - release)))


def place(signal, position):
    """Equal-power pan; position runs from -1 (left) to 1 (right)."""
    angle = (np.asarray(position) + 1) * np.pi / 4
    return np.stack([signal * np.cos(angle), signal * np.sin(angle)])


def band_noise(low, high):
    """White noise shaped to a soft band between two frequencies."""
    spectrum = np.fft.rfft(rng.standard_normal(t.size))
    frequency = np.fft.rfftfreq(t.size, 1 / RATE)
    shape = smooth((frequency - low * 0.7) / (low * 0.6)) * (1 - smooth((frequency - high) / (high * 0.8)))
    noise = np.fft.irfft(spectrum * shape, t.size)
    return noise / np.max(np.abs(noise))


def bell(start, frequency, amplitude, decay, position=0.0):
    """A glassy struck tone: a rounded attack and upper partials that fade first."""
    age = np.maximum(t - start, 0.0)
    partials = ((1.0, 1.0, 1.0), (2.01, 0.3, 0.45), (3.0, 0.1, 0.3), (4.17, 0.05, 0.18))
    tone = sum(
        weight * np.sin(2 * np.pi * frequency * ratio * age) * np.exp(-age / (decay * life))
        for ratio, weight, life in partials
    )
    return place(np.where(t >= start, tone * smooth(age / 0.012) * amplitude, 0.0), position)


def pad(frequencies, amplitude, level):
    """Slowly drifting sines, detuned between the channels for width."""
    channels = []
    for side, detune in ((0, 0.0), (1, 0.14)):
        voice = sum(
            np.sin(2 * np.pi * (f + detune) * t + 0.35 * np.sin(2 * np.pi * (0.09 + 0.02 * i + 0.01 * side) * t + i))
            + 0.12 * np.sin(4 * np.pi * (f + detune) * t + i)
            for i, f in enumerate(frequencies)
        )
        channels.append(voice / len(frequencies))
    return np.stack(channels) * amplitude * level


E2, B2, E3, B3, E4, GS4, B4 = 82.41, 123.47, 164.81, 246.94, 329.63, 415.30, 493.88
B5, E6, GS6, B6 = 987.77, 1318.51, 1661.22, 1975.53
ELECTRONS = ((0.85, 659.26, -0.45), (1.05, 830.61, 0.0), (1.25, 987.77, 0.45))
FLASH = 3.25

mix = np.zeros((2, t.size))
air = band_noise(1800, 7000)
breath = band_noise(300, 2400)

# The nucleus swells in on a warm fifth with a breath of air.
mix += pad((E3, B3), 0.14, envelope(0.3, 0.9, 2.6, 3.4))
mix += place(breath * 0.035 * envelope(0.15, 0.8, 0.9, 1.9), 0.0)

# Each electron launches with a glassy pluck and its first orbit swirls the air around.
for launch, frequency, position in ELECTRONS:
    mix += bell(launch, frequency, 0.085, 1.6, position)
    orbit = envelope(launch, 0.25, launch + 0.9, launch + 1.5)
    swirl = np.sin(2 * np.pi * (t - launch) / 1.3 + position * 2)
    mix += place(air * 0.022 * orbit, np.clip(0.75 * swirl, -1, 1))

# The orbits hum together, and the hum lifts toward the flash.
mix += pad((E4, GS4, B4), 0.07, envelope(1.2, 1.4, 3.1, 3.6) * (0.6 + 0.4 * smooth((t - 1.5) / 1.7)))
mix += place(air * 0.06 * envelope(2.2, 1.0, FLASH, FLASH + 0.35), 0.0)
riser = bell(0.0, E6, 0.1, 0.7)[:, : round(RATE * 1.0)][:, ::-1]
start = round(RATE * FLASH) - riser.shape[1]
mix[:, start : start + riser.shape[1]] += riser

# The flash rings out and the window blooms on a low chord that settles slowly.
for frequency, amplitude, position, delay in ((E6, 0.17, -0.15, 0.0), (GS6, 0.08, 0.25, 0.02), (B6, 0.1, 0.1, 0.035)):
    mix += bell(FLASH + delay, frequency, amplitude, 2.2, position)
mix += pad((E2, B2, E3), 0.36, envelope(FLASH - 0.05, 0.9, 4.7, 7.8))
mix += pad((E4, B4), 0.06, envelope(FLASH, 1.2, 5.4, 7.6))
mix += place(air * 0.02 * envelope(FLASH, 0.5, 4.2, 5.6), 0.0)

# The title lands with a quiet two-note chime.
mix += bell(5.6, B5, 0.06, 1.9, -0.2)
mix += bell(5.74, E6, 0.045, 2.2, 0.2)

# A small, dark room: decorrelated noise tails that lose their highs as they decay.
tail = np.arange(round(RATE * 2.6)) / RATE
room = []
for _ in range(2):
    spectrum = np.fft.rfft(rng.standard_normal(tail.size) * np.exp(-tail / 0.34))
    frequency = np.fft.rfftfreq(tail.size, 1 / RATE)
    room.append(np.fft.irfft(spectrum / (1 + (frequency / 5200) ** 2), tail.size))
size = 1 << int(np.ceil(np.log2(t.size + tail.size)))
wet = np.stack(
    [np.fft.irfft(np.fft.rfft(mix[c], size) * np.fft.rfft(room[c], size), size)[: t.size] for c in range(2)]
)
wet *= np.max(np.abs(mix)) / np.max(np.abs(wet))
out = mix + 0.3 * wet
out *= smooth(t / 0.01) * (1 - smooth((t - 8.2) / 0.8))
out *= 0.5 / np.max(np.abs(out))

with tempfile.TemporaryDirectory() as scratch:
    source = Path(scratch) / "atom-intro.wav"
    with wave.open(str(source), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((out.T * 32767).round().astype("<i2").tobytes())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", str(source), str(OUTPUT)],
        check=True,
    )

windows = out.reshape(2, -1, RATE // 4)
loudness = 20 * np.log10(np.sqrt(np.mean(windows**2, axis=(0, 2))) + 1e-9)
print(f"Saved {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB, {LENGTH:.1f} s)")
print("RMS per 0.25 s (dBFS):", " ".join(f"{value:.0f}" for value in loudness))
