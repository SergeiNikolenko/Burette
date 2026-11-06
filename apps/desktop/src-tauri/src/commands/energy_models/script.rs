//! A persistent Avogadro energy-model process, speaking the script energy
//! protocol of avogadro/qtplugins/forcefield/scriptenergy.cpp (avogadrolibs
//! cb0e94852889da9f7288bd1e58241e69990935a7, BSD-3-Clause; see
//! docs/third-party/avogadro-LICENSE).
//!
//! The process starts as `<script> <identifier> [--protocol binary-v1] --lang en`
//! and reads one compact JSON line (charge, spin, selected atoms, options and
//! the molecule in its declared format). Each request then sends coordinates:
//! - `text-v1`: one `x y z` line per atom; the reply holds `AvogadroEnergy: E`
//!   and, for models with gradients, `AvogadroGradient:` followed by one line
//!   per atom.
//! - `binary-v1`: a 16-byte little-endian header (`AVB1`, version 1, flags,
//!   atom count, payload bytes) and float64 coordinates; the reply frame holds
//!   the energy and gradient, or a UTF-8 message with the error flag.
//!
//! - binary-v1 batch (`support.batch`): the batch flag, a uint32 count before
//!   the coordinate sets, and a reply with the count and one energy per set.
//!
//! Energies are kJ/mol and gradients kJ/(mol·Å). Avogadro reads whatever text
//! the first readable chunk holds and treats a missing energy as zero; Burette
//! waits for a complete reply within the deadline instead, and discards
//! anything printed after it.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::manifest::Protocol;
use super::{Evaluation, CANCELLED, KJ_PER_KCAL};

const MAGIC: &[u8; 4] = b"AVB1";
const VERSION: u16 = 1;
const FLAG_BATCH_MODE: u16 = 0x0002;
const FLAG_REQUEST_ENERGY_AND_GRADIENT: u16 = 0x0004;
const FLAG_RESPONSE_ERROR: u16 = 0x8000;
const HEADER_BYTES: usize = 16;
/// A reply larger than this is not an energy and gradient of at most 256 atoms.
const MAX_REPLY_BYTES: usize = 1024 * 1024;
const STDERR_TAIL_BYTES: usize = 16 * 1024;
/// The first reply also covers start-up and model loading.
const FIRST_REPLY: Duration = Duration::from_secs(300);
const REPLY: Duration = Duration::from_secs(120);

pub(crate) struct ScriptSession {
    child: Child,
    requests: Option<SyncSender<Vec<u8>>>,
    replies: Receiver<Vec<u8>>,
    buffer: Vec<u8>,
    errors: Arc<Mutex<VecDeque<u8>>>,
    protocol: Protocol,
    gradients: bool,
    atoms: usize,
    answered: bool,
    /// Set once the reply stream may be out of step with the requests.
    broken: Option<String>,
}

impl Drop for ScriptSession {
    fn drop(&mut self) {
        // Closing stdin ends a well-behaved server; the kill covers the rest,
        // including descendants in the process group.
        self.requests.take();
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A close-on-exec pipe for the model's stdin: (read end, write end).
fn input_pipe() -> Result<(OwnedFd, OwnedFd), String> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err("The energy model's input could not be created".into());
    }
    let ends = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in [&ends.0, &ends.1] {
        unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    Ok(ends)
}

/// Waits until the process has read everything written so far, judged by a
/// copy of the pipe's read end that the stdout reader closes once the
/// process is gone.
///
/// Plugins read the bootstrap with Python's text-mode `sys.stdin.readline()`,
/// which reads ahead: a binary frame already in the pipe vanishes into the
/// text buffer and the plugin waits forever (avogadro-xtb-energy does this).
/// Avogadro escapes it only because evaluation starts long after set-up.
fn wait_until_read(probe: &Mutex<Option<OwnedFd>>) {
    loop {
        let Ok(mut slot) = probe.lock() else { return };
        let Some(fd) = slot.as_ref() else { return };
        let mut unread: libc::c_int = 0;
        if unsafe { libc::ioctl(fd.as_raw_fd(), libc::FIONREAD, &mut unread) } != 0 || unread == 0 {
            slot.take();
            return;
        }
        drop(slot);
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn format_float(value: f64) -> String {
    // Debug formatting round-trips and uses an exponent for tiny or huge values.
    format!("{value:?}")
}

impl ScriptSession {
    /// Starts the model process and sends the bootstrap line. `command` is the
    /// package's console script with its environment.
    pub(crate) fn start(
        mut command: Command,
        identifier: &str,
        protocol: Protocol,
        gradients: bool,
        bootstrap: &str,
        atoms: usize,
    ) -> Result<Self, String> {
        command.arg(identifier);
        if protocol == Protocol::BinaryV1 {
            command.args(["--protocol", "binary-v1"]);
        }
        let (input, output) = input_pipe()?;
        let probe = input
            .try_clone()
            .map_err(|error| format!("The energy model's input could not be created: {error}"))?;
        command
            .args(["--lang", "en"])
            .stdin(Stdio::from(input))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("The energy model could not be started: {error}"))?;
        // Close the parent's read end held by `command`, so only the probe stays.
        drop(command);
        let mut stdin = File::from(output);
        let probe = Arc::new(Mutex::new(Some(probe)));
        let mut stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        // Writes happen on their own thread so a process that stops reading
        // cannot block past the reply deadline.
        let (requests, pending) = mpsc::sync_channel::<Vec<u8>>(1);
        let bootstrap = format!("{bootstrap}\n").into_bytes();
        let consumed = probe.clone();
        std::thread::spawn(move || {
            if stdin.write_all(&bootstrap).is_err() {
                return;
            }
            wait_until_read(&consumed);
            for request in pending {
                if stdin
                    .write_all(&request)
                    .and_then(|()| stdin.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        // At most a few chunks wait unread, so a chatty process cannot grow memory.
        let (chunks, replies) = mpsc::sync_channel::<Vec<u8>>(4);
        std::thread::spawn(move || {
            let mut chunk = vec![0; 64 * 1024];
            while let Ok(read @ 1..) = stdout.read(&mut chunk) {
                if chunks.send(chunk[..read].to_vec()).is_err() {
                    break;
                }
            }
            // The process is gone: release a writer still waiting on the bootstrap.
            if let Ok(mut probe) = probe.lock() {
                probe.take();
            }
        });
        let errors = Arc::new(Mutex::new(VecDeque::new()));
        let tail = errors.clone();
        std::thread::spawn(move || {
            let mut chunk = [0; 4096];
            while let Ok(read @ 1..) = stderr.read(&mut chunk) {
                if let Ok(mut tail) = tail.lock() {
                    tail.extend(&chunk[..read]);
                    let excess = tail.len().saturating_sub(STDERR_TAIL_BYTES);
                    tail.drain(..excess);
                }
            }
        });
        Ok(Self {
            child,
            requests: Some(requests),
            replies,
            buffer: Vec::new(),
            errors,
            protocol,
            gradients,
            atoms,
            answered: false,
            broken: None,
        })
    }

    fn send(&self, request: Vec<u8>) -> Result<(), String> {
        self.requests
            .as_ref()
            .and_then(|requests| requests.send(request).ok())
            .ok_or_else(|| self.failure("The energy model stopped reading its input"))
    }

    fn failure(&self, what: &str) -> String {
        let text = self
            .errors
            .lock()
            .map(|tail| {
                String::from_utf8_lossy(&tail.iter().copied().collect::<Vec<_>>()).into_owned()
            })
            .unwrap_or_default();
        let lines: Vec<_> = text.lines().rev().take(8).collect();
        if lines.is_empty() {
            what.to_string()
        } else {
            let tail: Vec<_> = lines.into_iter().rev().collect();
            format!("{what}:\n{}", tail.join("\n"))
        }
    }

    /// Energy (kcal/mol) and gradient (kcal/(mol·Å)) at `coordinates`, x y z
    /// per atom in Å. Non-finite values in a reply are passed on as such.
    pub(crate) fn evaluate(
        &mut self,
        coordinates: &[f64],
        cancel: &AtomicBool,
    ) -> Result<Evaluation, String> {
        let (atoms, gradients) = (self.atoms, self.gradients);
        let parse: fn(&[u8], usize, bool) -> Parsed = match self.protocol {
            Protocol::TextV1 => parse_text,
            Protocol::BinaryV1 => parse_binary,
        };
        let request = self.request(coordinates);
        match self.round_trip(
            request,
            Duration::ZERO,
            |bytes| parse(bytes, atoms, gradients),
            cancel,
        )? {
            Parsed::Answer(energy, gradient) => Ok(Evaluation {
                energy: energy / KJ_PER_KCAL,
                gradient: gradient.map(|g| g.into_iter().map(|v| v / KJ_PER_KCAL).collect()),
            }),
            _ => unreachable!("round_trip returns answers only"),
        }
    }

    /// Energies (kcal/mol) of `sets` coordinate sets concatenated in `coordinates`,
    /// in one binary-v1 batch request.
    pub(crate) fn evaluate_energies(
        &mut self,
        coordinates: &[f64],
        sets: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<f64>, String> {
        let mut frame = Vec::with_capacity(HEADER_BYTES + 4 + 8 * coordinates.len());
        frame.extend_from_slice(MAGIC);
        frame.extend_from_slice(&VERSION.to_le_bytes());
        frame.extend_from_slice(&FLAG_BATCH_MODE.to_le_bytes());
        frame.extend_from_slice(&(self.atoms as u32).to_le_bytes());
        frame.extend_from_slice(&((4 + 8 * coordinates.len()) as u32).to_le_bytes());
        frame.extend_from_slice(&(sets as u32).to_le_bytes());
        coordinates
            .iter()
            .for_each(|value| frame.extend_from_slice(&value.to_le_bytes()));
        let atoms = self.atoms;
        // As Avogadro's evaluateBatchBinary, the deadline grows with the batch.
        let allowance = Duration::from_secs(sets as u64);
        match self.round_trip(
            frame,
            allowance,
            |bytes| parse_batch(bytes, atoms, sets),
            cancel,
        )? {
            Parsed::Energies(energies) => {
                Ok(energies.into_iter().map(|e| e / KJ_PER_KCAL).collect())
            }
            _ => unreachable!("round_trip returns answers only"),
        }
    }

    fn request(&self, coordinates: &[f64]) -> Vec<u8> {
        match self.protocol {
            Protocol::TextV1 => coordinates
                .chunks(3)
                .map(|p| {
                    format!(
                        "{} {} {}\n",
                        format_float(p[0]),
                        format_float(p[1]),
                        format_float(p[2])
                    )
                })
                .collect::<String>()
                .into_bytes(),
            Protocol::BinaryV1 => {
                let flags = if self.gradients {
                    FLAG_REQUEST_ENERGY_AND_GRADIENT
                } else {
                    0
                };
                let mut frame = Vec::with_capacity(HEADER_BYTES + 8 * coordinates.len());
                frame.extend_from_slice(MAGIC);
                frame.extend_from_slice(&VERSION.to_le_bytes());
                frame.extend_from_slice(&flags.to_le_bytes());
                frame.extend_from_slice(&(self.atoms as u32).to_le_bytes());
                frame.extend_from_slice(&((8 * coordinates.len()) as u32).to_le_bytes());
                coordinates
                    .iter()
                    .for_each(|value| frame.extend_from_slice(&value.to_le_bytes()));
                frame
            }
        }
    }

    /// Sends `request` and waits for the reply `parse` accepts. A broken reply
    /// stream refuses every later request.
    fn round_trip(
        &mut self,
        request: Vec<u8>,
        allowance: Duration,
        parse: impl Fn(&[u8]) -> Parsed,
        cancel: &AtomicBool,
    ) -> Result<Parsed, String> {
        if let Some(broken) = &self.broken {
            return Err(broken.clone());
        }
        let result = self.exchange(request, allowance, parse, cancel);
        if let Err(Failure::Broken(message)) = &result {
            self.broken = Some(format!("{message}; start the optimization again"));
        }
        result.map_err(|(Failure::Refused(message) | Failure::Broken(message))| message)
    }

    fn exchange(
        &mut self,
        request: Vec<u8>,
        allowance: Duration,
        parse: impl Fn(&[u8]) -> Parsed,
        cancel: &AtomicBool,
    ) -> Result<Parsed, Failure> {
        self.buffer.clear();
        self.send(request).map_err(Failure::Broken)?;
        let deadline = Instant::now() + allowance + if self.answered { REPLY } else { FIRST_REPLY };
        loop {
            match parse(&self.buffer) {
                Parsed::Pending => {}
                Parsed::Failed(failure) => {
                    self.buffer.clear();
                    return Err(failure);
                }
                answer => {
                    self.buffer.clear();
                    self.answered = true;
                    return Ok(answer);
                }
            }
            if self.buffer.len() > MAX_REPLY_BYTES {
                return Err(Failure::Broken(
                    "The energy model's reply is too large".into(),
                ));
            }
            if cancel.load(Ordering::Relaxed) {
                return Err(Failure::Broken(CANCELLED.into()));
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Failure::Broken(
                    "The energy model did not answer in time".into(),
                ));
            }
            match self
                .replies
                .recv_timeout(remaining.min(Duration::from_millis(50)))
            {
                Ok(chunk) => self.buffer.extend(chunk),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    // Let the stderr reader catch up with the exit message.
                    std::thread::sleep(Duration::from_millis(50));
                    return Err(Failure::Broken(
                        self.failure("The energy model process exited"),
                    ));
                }
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum Failure {
    /// The model answered this request with an error; later requests may succeed.
    Refused(String),
    /// Replies may no longer match requests.
    Broken(String),
}

#[derive(Debug, PartialEq)]
enum Parsed {
    Pending,
    Answer(f64, Option<Vec<f64>>),
    Energies(Vec<f64>),
    Failed(Failure),
}

fn broken(message: &str) -> Parsed {
    Parsed::Failed(Failure::Broken(message.into()))
}

/// Complete lines of `bytes`, without the trailing partial line.
fn complete_lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    let end = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    bytes[..end]
        .split(|b| *b == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
}

fn floats(text: &str, count: usize) -> Option<Vec<f64>> {
    let values: Vec<f64> = text
        .split_whitespace()
        .take(count)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    (values.len() == count).then_some(values)
}

/// A text-v1 reply once it is complete: the energy line, and for models with
/// gradients the marker and one `gx gy gz` line per atom (blank lines and
/// anything after the third number are skipped, as in Avogadro).
fn parse_text(bytes: &[u8], atoms: usize, gradients: bool) -> Parsed {
    let mut energy = None;
    let mut gradient: Option<Vec<f64>> = None;
    for line in complete_lines(bytes) {
        let line = String::from_utf8_lossy(line);
        if let Some(values) = gradient.as_mut().filter(|values| values.len() < 3 * atoms) {
            if line.trim().is_empty() {
                continue;
            }
            match floats(&line, 3) {
                Some(triplet) => values.extend(triplet),
                None => return broken("The energy model sent an unreadable gradient"),
            }
        } else if let Some((_, rest)) = line.split_once("AvogadroEnergy:") {
            match floats(rest, 1) {
                Some(value) => energy = Some(value[0]),
                None => return broken("Could not read the energy after \"AvogadroEnergy:\""),
            }
        } else if gradients && line.contains("AvogadroGradient:") {
            gradient = Some(Vec::with_capacity(3 * atoms));
        }
        let gradient_done = !gradients || gradient.as_ref().is_some_and(|g| g.len() == 3 * atoms);
        if let (Some(energy), true) = (energy, gradient_done) {
            return Parsed::Answer(energy, gradient);
        }
    }
    Parsed::Pending
}

/// A complete binary-v1 frame: its flags, atom count and payload, or the
/// reply to return while it is incomplete, malformed or an error.
fn binary_frame(bytes: &[u8]) -> Result<(u16, usize, &[u8]), Parsed> {
    if bytes.len() < HEADER_BYTES {
        return Err(Parsed::Pending);
    }
    let u16_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    if &bytes[..4] != MAGIC {
        return Err(broken("Invalid binary response magic"));
    }
    if u16_at(4) != VERSION {
        return Err(broken("Unsupported binary response version"));
    }
    let (flags, count, payload) = (u16_at(6), u32_at(8), u32_at(12));
    if payload > MAX_REPLY_BYTES {
        return Err(broken("The energy model's reply is too large"));
    }
    let total = HEADER_BYTES + payload;
    if bytes.len() < total {
        return Err(Parsed::Pending);
    }
    if bytes.len() > total {
        return Err(broken("Binary response contained trailing bytes"));
    }
    let body = &bytes[HEADER_BYTES..];
    if flags & FLAG_RESPONSE_ERROR != 0 {
        let message = String::from_utf8_lossy(&body[..body.len().min(2048)]);
        return Err(Parsed::Failed(Failure::Refused(format!(
            "The energy model reported an error: {message}"
        ))));
    }
    Ok((flags, count, body))
}

fn doubles(bytes: &[u8]) -> Vec<f64> {
    bytes
        .chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}

/// A binary-v1 reply frame once it is complete.
fn parse_binary(bytes: &[u8], atoms: usize, gradients: bool) -> Parsed {
    let (_, count, body) = match binary_frame(bytes) {
        Ok(frame) => frame,
        Err(parsed) => return parsed,
    };
    let expected = 8 + if gradients { 24 * atoms } else { 0 };
    if count != atoms || body.len() != expected {
        return broken("The energy model's reply does not match the structure");
    }
    let values = doubles(body);
    Parsed::Answer(values[0], gradients.then(|| values[1..].to_vec()))
}

/// A binary-v1 batch reply: the batch flag, the set count, then one energy per set.
fn parse_batch(bytes: &[u8], atoms: usize, sets: usize) -> Parsed {
    let (flags, count, body) = match binary_frame(bytes) {
        Ok(frame) => frame,
        Err(parsed) => return parsed,
    };
    let batch = body
        .get(..4)
        .map(|n| u32::from_le_bytes(n.try_into().unwrap()) as usize);
    if flags & FLAG_BATCH_MODE == 0
        || count != atoms
        || batch != Some(sets)
        || body.len() != 4 + 8 * sets
    {
        return broken("The energy model's batch reply does not match the request");
    }
    Parsed::Energies(doubles(&body[4..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_replies_wait_for_every_gradient_line_and_skip_extra_columns() {
        let reply = b"warming up\nAvogadroEnergy: -4.184\nAvogadroGradient:\n 4.184 0 -8.368\n\n";
        assert_eq!(
            parse_text(&reply[..reply.len() - 12], 2, true),
            Parsed::Pending
        );
        assert_eq!(parse_text(reply, 2, true), Parsed::Pending);
        let complete = [&reply[..], b"0.0 1e-3 2 extra\n"].concat();
        assert_eq!(
            parse_text(&complete, 2, true),
            Parsed::Answer(-4.184, Some(vec![4.184, 0.0, -8.368, 0.0, 1e-3, 2.0]))
        );
        assert_eq!(
            parse_text(b"AvogadroEnergy: 2.5\n", 3, false),
            Parsed::Answer(2.5, None)
        );
        assert_eq!(
            parse_text(b"AvogadroEnergy: 2.5", 3, false),
            Parsed::Pending
        );
        assert!(matches!(
            parse_text(b"AvogadroEnergy: abc\n", 1, false),
            Parsed::Failed(Failure::Broken(_))
        ));
        assert!(matches!(
            parse_text(b"AvogadroEnergy: 1\nAvogadroGradient:\n1 2\n", 1, true),
            Parsed::Failed(Failure::Broken(_))
        ));
    }

    fn frame(flags: u16, atoms: u32, payload: &[u8]) -> Vec<u8> {
        [
            &MAGIC[..],
            &VERSION.to_le_bytes(),
            &flags.to_le_bytes(),
            &atoms.to_le_bytes(),
            &(payload.len() as u32).to_le_bytes(),
            payload,
        ]
        .concat()
    }

    #[test]
    fn binary_frames_are_complete_exact_and_report_errors() {
        let payload: Vec<u8> = [1.5f64, 0.25, -0.5, 2.0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let reply = frame(FLAG_REQUEST_ENERGY_AND_GRADIENT, 1, &payload);
        assert_eq!(parse_binary(&reply[..20], 1, true), Parsed::Pending);
        assert_eq!(
            parse_binary(&reply, 1, true),
            Parsed::Answer(1.5, Some(vec![0.25, -0.5, 2.0]))
        );
        assert_eq!(
            parse_binary(&[&reply[..], b"x"].concat(), 1, true),
            broken("Binary response contained trailing bytes")
        );
        assert!(matches!(
            parse_binary(&reply, 2, true),
            Parsed::Failed(Failure::Broken(_))
        ));
        assert_eq!(
            parse_binary(&frame(FLAG_RESPONSE_ERROR, 1, b"no SCF"), 1, true),
            Parsed::Failed(Failure::Refused(
                "The energy model reported an error: no SCF".into()
            ))
        );
        assert_eq!(
            parse_binary(b"XXXX............", 1, true),
            broken("Invalid binary response magic")
        );
        let energy = frame(0, 3, &7.0f64.to_le_bytes());
        assert_eq!(parse_binary(&energy, 3, false), Parsed::Answer(7.0, None));
    }
}
