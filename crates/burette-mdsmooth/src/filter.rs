//! Low-pass filtering and key-frame detection for a per-frame signal.
//!
//! A port of the default path of `scripts/mdsmooth_core/filter.py`
//! (`filter_rmsd`), including the SciPy routines it calls: `butter`,
//! `filtfilt` with odd padding, and `find_peaks` without conditions.

use std::f64::consts::PI;

/// A signal whose full range is below this fraction of its own magnitude is flat.
const FLAT_SIGNAL_REL_TOL: f64 = 1e-5;
const COSINE_CONTENT_WARN: f64 = 0.85;
/// The spectrum is a direct O(n^2) transform; longer signals go to the Python runner.
pub const MAX_SPECTRUM_SAMPLES: usize = 20_000;

/// How the caller named the single degree of freedom, the low-pass cutoff.
#[derive(Clone, Copy, Debug)]
pub enum Cutoff {
    /// Solve for the cutoff that yields about this many key frames.
    TargetFrames(usize),
    /// Cycles per frame.
    Frequency(f64),
    /// Fraction of cumulative spectral power to retain.
    PowerFraction(f64),
}

pub struct Spectrum {
    pub frequencies: Vec<f64>,
    pub power: Vec<f64>,
    pub cumulative: Vec<f64>,
}

pub struct Filtered {
    pub filtered: Vec<f64>,
    pub cutoff_frequency: f64,
    /// 0-based key frames in ascending order.
    pub frames: Vec<usize>,
    /// "max", "min", "end" or "user" for each key frame.
    pub kinds: Vec<&'static str>,
    pub cosine_content: f64,
}

impl Filtered {
    pub fn cosine_content_high(&self) -> bool {
        self.cosine_content >= COSINE_CONTENT_WARN
    }
}

/// One-sided power spectrum of the mean-removed signal.
pub fn power_spectrum(signal: &[f64]) -> Result<Spectrum, String> {
    let n = signal.len();
    if n < 2 {
        return Err("Need at least two RMSD samples for a spectrum.".into());
    }
    if n > MAX_SPECTRUM_SAMPLES {
        return Err("The trajectory is too long for the native spectrum.".into());
    }
    let mean = signal.iter().sum::<f64>() / n as f64;
    let table: Vec<(f64, f64)> = (0..n)
        .map(|index| (2.0 * PI * index as f64 / n as f64).sin_cos())
        .collect();
    let bins = n / 2 + 1;
    let mut power = Vec::with_capacity(bins);
    for bin in 0..bins {
        let (mut re, mut im) = (0.0, 0.0);
        let mut phase = 0;
        for value in signal {
            let (sin, cos) = table[phase];
            re += (value - mean) * cos;
            im -= (value - mean) * sin;
            phase += bin;
            if phase >= n {
                phase -= n;
            }
        }
        power.push(re * re + im * im);
    }
    let total: f64 = power.iter().sum();
    let mut running = 0.0;
    let cumulative = power
        .iter()
        .map(|value| {
            running += value;
            if total > 0.0 {
                running / total
            } else {
                0.0
            }
        })
        .collect();
    let frequencies = (0..bins).map(|bin| bin as f64 / n as f64).collect();
    Ok(Spectrum {
        frequencies,
        power,
        cumulative,
    })
}

/// Hess's cosine content in `[0, 1]`; near 1 suggests undersampled diffusion.
fn cosine_content(signal: &[f64]) -> f64 {
    let n = signal.len() as f64;
    let mean = signal.iter().sum::<f64>() / n;
    let denominator: f64 = signal.iter().map(|value| (value - mean).powi(2)).sum();
    if denominator == 0.0 {
        return 0.0;
    }
    let projection: f64 = signal
        .iter()
        .enumerate()
        .map(|(index, value)| (PI * index as f64 / n).cos() * (value - mean))
        .sum();
    (2.0 / n) * projection * projection / denominator
}

fn is_flat(signal: &[f64]) -> bool {
    let scale = signal
        .iter()
        .fold(0.0_f64, |acc, value| acc.max(value.abs()));
    if scale == 0.0 {
        return true;
    }
    let max = signal.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let min = signal.iter().cloned().fold(f64::INFINITY, f64::min);
    max - min <= FLAT_SIGNAL_REL_TOL * scale
}

/// One second-order section: numerator and denominator, `a[0] == 1`.
type Section = ([f64; 3], [f64; 3]);

/// Digital Butterworth low-pass as cascaded second-order sections, laid out as
/// `scipy.signal.butter(..., output="sos")`: the real pole of an odd order
/// first, then conjugate pairs with the pair nearest the unit circle last, and
/// the whole gain in the first section.
fn butter(order: usize, normalized_cutoff: f64) -> Vec<Section> {
    let warped = 4.0 * (PI * normalized_cutoff / 2.0).tan();
    let mut sections = Vec::with_capacity(order.div_ceil(2));
    let mut gain = 1.0;
    if order % 2 == 1 {
        gain *= warped / (4.0 + warped);
        sections.push((
            [1.0, 1.0, 0.0],
            [1.0, -(4.0 - warped) / (4.0 + warped), 0.0],
        ));
    }
    for index in (0..order / 2).rev() {
        let m = (2 * index) as f64 - (order as f64 - 1.0);
        let (sin, cos) = (PI * m / (2.0 * order as f64)).sin_cos();
        // Analog pole x + iy maps to (4 + s) / (4 - s).
        let (x, y) = (-cos * warped, -sin * warped);
        let denominator = (4.0 - x) * (4.0 - x) + y * y;
        gain *= warped * warped / denominator;
        sections.push((
            [1.0, 2.0, 1.0],
            [
                1.0,
                -2.0 * (16.0 - x * x - y * y) / denominator,
                ((4.0 + x) * (4.0 + x) + y * y) / denominator,
            ],
        ));
    }
    if let Some((b, _)) = sections.first_mut() {
        b.iter_mut().for_each(|value| *value *= gain);
    }
    sections
}

/// Steady-state filter state for a unit step, as `scipy.signal.lfilter_zi`.
fn lfilter_zi(b: &[f64], a: &[f64]) -> Vec<f64> {
    let size = a.len() - 1;
    // (I - companion(a)^T) zi = b[1:] - a[1:] * b[0]
    let mut matrix = vec![vec![0.0; size + 1]; size];
    for row in 0..size {
        matrix[row][row] = 1.0;
        matrix[row][0] += a[row + 1] / a[0];
        if row + 1 < size {
            matrix[row][row + 1] -= 1.0;
        }
        matrix[row][size] = b[row + 1] - a[row + 1] * b[0];
    }
    for pivot in 0..size {
        let best = (pivot..size)
            .max_by(|&left, &right| {
                matrix[left][pivot]
                    .abs()
                    .total_cmp(&matrix[right][pivot].abs())
            })
            .unwrap_or(pivot);
        matrix.swap(pivot, best);
        let pivot_row = matrix[pivot].clone();
        for (row, values) in matrix.iter_mut().enumerate() {
            if row == pivot || pivot_row[pivot] == 0.0 {
                continue;
            }
            let factor = values[pivot] / pivot_row[pivot];
            for (value, pivot_value) in values.iter_mut().zip(&pivot_row).skip(pivot) {
                *value -= factor * pivot_value;
            }
        }
    }
    (0..size)
        .map(|row| matrix[row][size] / matrix[row][row])
        .collect()
}

/// Direct form II transposed, starting from `state`.
fn lfilter(b: &[f64], a: &[f64], input: &[f64], mut state: Vec<f64>) -> Vec<f64> {
    let size = state.len();
    input
        .iter()
        .map(|&x| {
            let y = b[0] * x + state[0];
            for index in 0..size {
                let next = if index + 1 < size {
                    state[index + 1]
                } else {
                    0.0
                };
                state[index] = b[index + 1] * x + next - a[index + 1] * y;
            }
            y
        })
        .collect()
}

/// One pass of the cascade, each section starting from its unit-step steady
/// state scaled to the first sample (`scipy.signal.sosfilt_zi`).
fn sosfilt(sections: &[Section], input: &[f64]) -> Vec<f64> {
    let first = input[0];
    let mut scale = 1.0;
    let mut output = input.to_vec();
    for (b, a) in sections {
        let state = lfilter_zi(b, a)
            .iter()
            .map(|value| value * scale * first)
            .collect();
        output = lfilter(b, a, &output, state);
        scale *= b.iter().sum::<f64>() / a.iter().sum::<f64>();
    }
    output
}

/// Zero-phase Butterworth low-pass (`scipy.signal.sosfiltfilt`, odd padding).
/// Second-order sections stay accurate at low cutoffs, where one high-order
/// transfer function loses all precision.
fn butter_lowpass(signal: &[f64], cutoff_frequency: f64, order: usize) -> Vec<f64> {
    let normalized = (cutoff_frequency / 0.5).clamp(1e-6, 1.0 - 1e-6);
    let sections = butter(order, normalized);
    let n = signal.len();
    let pad = (3 * (order + 1)).min(n - 1);
    let mut extended = Vec::with_capacity(n + 2 * pad);
    extended.extend((1..=pad).rev().map(|index| 2.0 * signal[0] - signal[index]));
    extended.extend_from_slice(signal);
    extended.extend((1..=pad).map(|index| 2.0 * signal[n - 1] - signal[n - 1 - index]));
    let mut forward = sosfilt(&sections, &extended);
    forward.reverse();
    let mut backward = sosfilt(&sections, &forward);
    backward.reverse();
    backward[pad..pad + n].to_vec()
}

/// Local maxima, taking the middle of a plateau (`scipy.signal.find_peaks`).
fn find_peaks(signal: &[f64], sign: f64) -> Vec<usize> {
    let n = signal.len();
    let mut peaks = Vec::new();
    let mut index = 1;
    while index + 1 < n {
        if sign * signal[index - 1] < sign * signal[index] {
            let mut ahead = index + 1;
            while ahead + 1 < n && signal[ahead] == signal[index] {
                ahead += 1;
            }
            if sign * signal[ahead] < sign * signal[index] {
                peaks.push((index + ahead - 1) / 2);
                index = ahead;
            }
        }
        index += 1;
    }
    peaks
}

fn significant_frames(
    filtered: &[f64],
    include_ends: bool,
    extra_frames: &[usize],
) -> (Vec<usize>, Vec<&'static str>) {
    let mut kinds: Vec<Option<&'static str>> = vec![None; filtered.len()];
    for index in find_peaks(filtered, 1.0) {
        kinds[index] = Some("max");
    }
    for index in find_peaks(filtered, -1.0) {
        kinds[index] = Some("min");
    }
    if include_ends && !filtered.is_empty() {
        kinds[0].get_or_insert("end");
        kinds[filtered.len() - 1].get_or_insert("end");
    }
    for &index in extra_frames {
        if index < filtered.len() {
            kinds[index].get_or_insert("user");
        }
    }
    kinds
        .iter()
        .enumerate()
        .filter_map(|(index, kind)| kind.map(|kind| (index, kind)))
        .unzip()
}

/// Bisect the cutoff whose key-frame count comes closest to `target`.
fn cutoff_for_frame_count(signal: &[f64], target: usize, order: usize, include_ends: bool) -> f64 {
    let (mut low, mut high) = (1e-6 * 0.5, 0.5 * (1.0 - 1e-6));
    let mut best_cutoff = high;
    let mut best_difference = None;
    for _ in 0..48 {
        let middle = 0.5 * (low + high);
        let count = significant_frames(&butter_lowpass(signal, middle, order), include_ends, &[])
            .0
            .len();
        let difference = count.abs_diff(target);
        if best_difference
            .is_none_or(|best| difference < best || (difference == best && middle < best_cutoff))
        {
            best_difference = Some(difference);
            best_cutoff = middle;
        }
        if count < target {
            low = middle;
        } else {
            high = middle;
        }
    }
    best_cutoff
}

fn cutoff_for_power_fraction(spectrum: &Spectrum, fraction: f64) -> Result<f64, String> {
    if !(fraction > 0.0 && fraction < 1.0) {
        return Err("power_fraction must be between 0 and 1 (exclusive).".into());
    }
    if spectrum.power.iter().sum::<f64>() == 0.0 {
        return Ok(0.5);
    }
    let index = spectrum
        .cumulative
        .iter()
        .position(|value| *value >= fraction)
        .unwrap_or(spectrum.cumulative.len() - 1);
    let cutoff = spectrum.frequencies[index];
    Ok(if cutoff > 0.0 {
        cutoff
    } else {
        spectrum.frequencies[1]
    })
}

/// Filter the signal and pick its key frames.
pub fn filter_signal(
    signal: &[f64],
    spectrum: &Spectrum,
    cutoff: Cutoff,
    order: usize,
    include_ends: bool,
    extra_frames: &[usize],
) -> Result<Filtered, String> {
    let cosine_content = cosine_content(signal);
    // A rigid selection has no real extrema; filtering it leaves only ripple
    // that the frame-count solver would otherwise promote to key frames.
    if is_flat(signal) {
        let (frames, kinds) =
            significant_frames(&vec![0.0; signal.len()], include_ends, extra_frames);
        return Ok(Filtered {
            filtered: signal.to_vec(),
            cutoff_frequency: 0.5,
            frames,
            kinds,
            cosine_content,
        });
    }
    let cutoff_frequency = match cutoff {
        Cutoff::TargetFrames(target) => cutoff_for_frame_count(signal, target, order, include_ends),
        Cutoff::Frequency(frequency) => frequency,
        Cutoff::PowerFraction(fraction) => cutoff_for_power_fraction(spectrum, fraction)?,
    };
    let filtered = butter_lowpass(signal, cutoff_frequency, order);
    let (frames, kinds) = significant_frames(&filtered, include_ends, extra_frames);
    Ok(Filtered {
        filtered,
        cutoff_frequency,
        frames,
        kinds,
        cosine_content,
    })
}
