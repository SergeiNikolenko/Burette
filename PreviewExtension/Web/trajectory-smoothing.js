(function () {
  'use strict';

  const PRESETS = {
    light: { targetRatio: 0.55, passes: 1 },
    balanced: { targetRatio: 0.32, passes: 2 },
    strong: { targetRatio: 0.18, passes: 3 }
  };

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function parsePdb(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const frames = [];
    let current = [];
    let inModel = false;
    const flush = () => {
      if (current.length) frames.push(current);
      current = [];
    };
    for (const line of lines) {
      if (/^MODEL\b/.test(line)) {
        if (inModel) flush();
        inModel = true;
      } else if (/^ENDMDL\b/.test(line)) {
        flush();
        inModel = false;
      } else if (/^(ATOM  |HETATM)/.test(line)) {
        current.push({
          line,
          x: finiteNumber(line.slice(30, 38), NaN),
          y: finiteNumber(line.slice(38, 46), NaN),
          z: finiteNumber(line.slice(46, 54), NaN)
        });
      }
    }
    flush();
    if (frames.length < 2 || frames.some(frame => frame.length !== frames[0].length)) {
      throw new Error('Smoothing needs a multi-model PDB with the same atoms in every frame.');
    }
    return {
      format: 'pdb',
      frames: frames.map(frame => frame.map(atom => [atom.x, atom.y, atom.z])),
      atomLines: frames[0].map(atom => atom.line)
    };
  }

  function parseXyz(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const frames = [];
    let index = 0;
    while (index < lines.length) {
      while (index < lines.length && !lines[index].trim()) index += 1;
      if (index >= lines.length) break;
      const atomCount = Number(lines[index].trim());
      if (!Number.isInteger(atomCount) || atomCount <= 0) throw new Error('Invalid XYZ trajectory frame.');
      const comment = lines[index + 1] || '';
      const atoms = [];
      for (let atomIndex = 0; atomIndex < atomCount; atomIndex += 1) {
        const fields = String(lines[index + 2 + atomIndex] || '').trim().split(/\s+/);
        if (fields.length < 4) throw new Error('Invalid XYZ atom row.');
        atoms.push({ element: fields[0], coords: fields.slice(1, 4).map(value => finiteNumber(value, NaN)) });
      }
      frames.push({ comment, atoms });
      index += atomCount + 2;
    }
    if (frames.length < 2 || frames.some(frame => frame.atoms.length !== frames[0].atoms.length)) {
      throw new Error('Smoothing needs a multi-frame XYZ with the same atoms in every frame.');
    }
    return {
      format: 'xyz',
      frames: frames.map(frame => frame.atoms.map(atom => atom.coords)),
      elements: frames[0].atoms.map(atom => atom.element)
    };
  }

  function centroid(frame) {
    const center = [0, 0, 0];
    for (const point of frame) {
      center[0] += point[0]; center[1] += point[1]; center[2] += point[2];
    }
    return center.map(value => value / frame.length);
  }

  function rmsdSeries(frames, referenceIndex, centerFrames) {
    const reference = frames[referenceIndex];
    const referenceCenter = centerFrames ? centroid(reference) : [0, 0, 0];
    return frames.map(frame => {
      const frameCenter = centerFrames ? centroid(frame) : [0, 0, 0];
      let squared = 0;
      for (let atom = 0; atom < frame.length; atom += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const delta = (frame[atom][axis] - frameCenter[axis]) - (reference[atom][axis] - referenceCenter[axis]);
          squared += delta * delta;
        }
      }
      return Math.sqrt(squared / frame.length);
    });
  }

  function smoothSeries(values, radius, passes) {
    let current = values.slice();
    for (let pass = 0; pass < passes; pass += 1) {
      const next = current.map((_, index) => {
        let sum = 0;
        let weight = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const source = Math.max(0, Math.min(current.length - 1, index + offset));
          const localWeight = radius + 1 - Math.abs(offset);
          sum += current[source] * localWeight;
          weight += localWeight;
        }
        return sum / weight;
      });
      current = next;
    }
    return current;
  }

  function extrema(values) {
    const frames = [0];
    for (let index = 1; index < values.length - 1; index += 1) {
      const before = values[index - 1];
      const value = values[index];
      const after = values[index + 1];
      if ((value > before && value >= after) || (value < before && value <= after)) frames.push(index);
    }
    frames.push(values.length - 1);
    return Array.from(new Set(frames));
  }

  function thinKeyframes(frames, target) {
    if (frames.length <= target) return frames;
    return Array.from({ length: target }, (_, index) => frames[Math.round(index * (frames.length - 1) / (target - 1))]);
  }

  function interpolateFrames(source, keyframes) {
    const output = new Array(source.length);
    for (let segment = 1; segment < keyframes.length; segment += 1) {
      const start = keyframes[segment - 1];
      const end = keyframes[segment];
      for (let frameIndex = start; frameIndex <= end; frameIndex += 1) {
        const t = end === start ? 0 : (frameIndex - start) / (end - start);
        output[frameIndex] = source[start].map((point, atom) => point.map((value, axis) => (
          value + (source[end][atom][axis] - value) * t
        )));
      }
    }
    return output;
  }

  function formatPdb(parsed, frames) {
    const output = [];
    frames.forEach((frame, frameIndex) => {
      output.push(`MODEL     ${String(frameIndex + 1).padStart(4, ' ')}`);
      parsed.atomLines.forEach((line, atomIndex) => {
        const [x, y, z] = frame[atomIndex];
        output.push(`${line.slice(0, 30)}${x.toFixed(3).padStart(8, ' ')}${y.toFixed(3).padStart(8, ' ')}${z.toFixed(3).padStart(8, ' ')}${line.slice(54)}`);
      });
      output.push('ENDMDL');
    });
    output.push('END');
    return `${output.join('\n')}\n`;
  }

  function formatXyz(parsed, frames) {
    const output = [];
    frames.forEach((frame, frameIndex) => {
      output.push(String(frame.length), `Smoothed motion frame ${frameIndex + 1}`);
      frame.forEach((point, atomIndex) => output.push(`${parsed.elements[atomIndex]} ${point.map(value => value.toFixed(6)).join(' ')}`));
    });
    return `${output.join('\n')}\n`;
  }

  function smooth(input) {
    const format = String(input?.format || '').toLowerCase();
    const parsed = format === 'pdb' ? parsePdb(input.data) : format === 'xyz' ? parseXyz(input.data) : null;
    if (!parsed) throw new Error('This first smoothing version supports multi-model PDB and multi-frame XYZ trajectories.');
    const preset = PRESETS[input.preset] || PRESETS.balanced;
    const referenceIndex = Math.max(0, Math.min(parsed.frames.length - 1, Math.trunc(finiteNumber(input.referenceFrame, 1)) - 1));
    const targetFrames = Math.max(2, Math.min(parsed.frames.length, Math.trunc(finiteNumber(input.targetFrames, parsed.frames.length * preset.targetRatio))));
    const radius = Math.max(1, Math.round(parsed.frames.length / Math.max(8, targetFrames * 2)));
    const rawSignal = rmsdSeries(parsed.frames, referenceIndex, input.align !== false);
    const filteredSignal = smoothSeries(rawSignal, radius, preset.passes);
    const keyframes = thinKeyframes(extrema(filteredSignal), targetFrames);
    const frames = interpolateFrames(parsed.frames, keyframes);
    return {
      data: parsed.format === 'pdb' ? formatPdb(parsed, frames) : formatXyz(parsed, frames),
      format: parsed.format,
      frameCount: frames.length,
      keyframes,
      rawSignal,
      filteredSignal,
      targetFrames,
      interpolation: 'linear'
    };
  }

  function concatenateXtcSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new Error('Combined trajectory needs at least one XTC segment.');
    }
    let byteCount = 0;
    for (const segment of segments) {
      if (!segment || typeof segment.length !== 'number' || typeof segment.subarray !== 'function') {
        throw new Error('Every XTC trajectory segment must be binary data.');
      }
      if (segment.length === 0) {
        throw new Error('XTC trajectory segments must not be empty.');
      }
      byteCount += segment.length;
    }
    const combined = new Uint8Array(byteCount);
    let offset = 0;
    for (const segment of segments) {
      combined.set(segment, offset);
      offset += segment.length;
    }
    return combined;
  }

  window.BurreteTrajectorySmoothing = { smooth, concatenateXtcSegments };
})();
