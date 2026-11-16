//! SVG output in ACS 1996 proportions (ReShiki `style.rs`): bond 14.4 pt,
//! labels 10 pt, lines 0.6 pt, wedges 2 pt, label margin 1.6 pt, hashes every
//! 2.5 pt, double-bond spacing 18 %. Geometry is computed in model units (one
//! bond) and written in viewport pixels; all colour comes from CSS classes.
use crate::geometry::{Box2, V2, bond_angles, box_gap, box_segment_gap, centroid, rings, sectors, segment_distance, v2, wave};
use crate::model::{Adjacency, Bond, Item, Mol, SGroup, Stereo};
use crate::valence::{Valence, symbol, valence};
use std::f64::consts::TAU;

/// Pixels per bond length at 100 %: labels come out at 15.6 px, a little
/// above the 13–14 px interface text around the canvas.
pub const NATURAL_SCALE: f64 = 22.5;
const PT: f64 = 1. / 14.4;
const FONT: f64 = 10. * PT;
const LINE: f64 = 0.6 * PT;
const BOLD: f64 = 2. * PT;
const MARGIN: f64 = 1.6 * PT;
const HASH: f64 = 2.5 * PT;
const SPACING: f64 = 0.18;
const INNER_TRIM: f64 = SPACING * 0.75;
const SMALL: f64 = 0.7;
const CIP_FONT: f64 = 7.5 * PT;
/// Helvetica cap height and script baseline shifts, in em.
const CAP: f64 = 0.718;
const SUB: f64 = 0.25;
const SUP: f64 = 0.4;
/// Stacked H baseline distance from the element baseline, in em.
const STACK: f64 = 0.95;
/// Halo radii around unlabeled atoms and bonds, and padding around labels.
const DOT: f64 = 0.2;
const BOND_HALO: f64 = 0.15;
const PAD: f64 = 0.08;

#[derive(Clone, Copy, Debug)]
pub struct View {
    /// Pixels per bond length.
    pub scale: f64,
    /// Screen position of the model origin.
    pub offset: V2,
    pub width: f64,
    pub height: f64,
}

impl View {
    pub fn screen(&self, p: V2) -> V2 {
        p * self.scale + self.offset
    }
    pub fn model(&self, p: V2) -> V2 {
        (p - self.offset) * (1. / self.scale)
    }
}

/// Ghost of a pending edit: `mol` is the result, items from the given indices are new.
#[derive(Clone, Debug, PartialEq)]
pub struct Preview {
    pub mol: Mol,
    pub atoms_from: usize,
    pub bonds_from: usize,
    pub sgroups_from: usize,
    pub note: Option<(V2, String)>,
}

pub type Cip = (Vec<Option<&'static str>>, Vec<Option<&'static str>>);

#[derive(Default)]
pub struct Overlay<'a> {
    pub hover: Option<Item>,
    pub atoms: &'a [bool],
    pub bonds: &'a [bool],
    pub preview: Option<&'a Preview>,
    /// Model-space corners.
    pub marquee: Option<(V2, V2)>,
    /// CIP marks from [`cip_marks`].
    pub cip: Option<&'a [(V2, String)]>,
    /// Repeat unit whose brackets are hovered.
    pub bracket: Option<usize>,
}

// ------------------------------------------------------------------ labels

/// Helvetica advance widths (Arial is metric-compatible), in em.
fn advance(c: char) -> f64 {
    let w = match c {
        'I' => 278,
        'J' => 500,
        'L' => 556,
        'M' | 'm' => 833,
        'W' => 944,
        'F' | 'T' | 'Z' => 611,
        'A' | 'B' | 'E' | 'K' | 'P' | 'S' | 'V' | 'X' | 'Y' => 667,
        'C' | 'D' | 'H' | 'N' | 'R' | 'U' | 'w' => 722,
        'G' | 'O' | 'Q' => 778,
        'i' | 'j' | 'l' => 222,
        'f' | 't' => 278,
        'r' | '(' | ')' => 333,
        'c' | 'k' | 's' | 'v' | 'x' | 'y' | 'z' => 500,
        '+' | '−' => 584,
        '•' => 350,
        '*' => 389,
        _ => 556,
    };
    w as f64 / 1000.
}

fn width(text: &str, size: f64) -> f64 {
    text.chars().map(advance).sum::<f64>() * size
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Script {
    Normal,
    Sub,
    Sup,
    Charge,
}

impl Script {
    fn size(self) -> f64 {
        if self == Script::Normal { FONT } else { FONT * SMALL }
    }
    fn shift(self) -> f64 {
        match self {
            Script::Normal => 0.,
            Script::Sub => SUB * FONT,
            Script::Sup | Script::Charge => -SUP * FONT,
        }
    }
}

struct Line {
    x: f64,
    base: f64,
    runs: Vec<(Script, String)>,
}

struct Label {
    el: &'static str,
    lines: Vec<Line>,
    /// Glyph boxes (min, max) that trim bonds.
    boxes: Vec<(V2, V2)>,
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Left,
    Right,
    Above,
    Below,
}

/// Side of the implicit-H appendage, after ReShiki's `appendage_position`:
/// away from the bonds, stacked when the open side is vertical.
fn h_side(mol: &Mol, adj: &Adjacency, i: usize) -> Side {
    let p = mol.atoms[i].pos;
    let dirs: Vec<V2> = adj[i]
        .iter()
        .map(|&(_, n)| mol.atoms[n].pos - p)
        .filter(|d| d.len() > 1e-6)
        .map(V2::unit)
        .collect();
    let sum = dirs.iter().fold(V2::default(), |s, d| s + *d);
    let inline = |left: bool| if left { Side::Left } else { Side::Right };
    let cone = 22.5f64.to_radians().tan();
    match dirs.as_slice() {
        [] => inline(matches!(mol.atoms[i].el, 8 | 9 | 16 | 17 | 34 | 35 | 52 | 53 | 85)),
        [_] => inline(sum.x > 0.1),
        [first, second] => {
            if sum.len() > 1e-3 {
                if sum.x.abs() < sum.y.abs() * cone {
                    return if sum.y > 0. { Side::Above } else { Side::Below };
                }
                return inline(sum.x > 0.);
            }
            if first.y.abs() < first.x.abs() * cone {
                return Side::Above;
            }
            let lower = if first.y > second.y { first } else { second };
            inline(lower.x < 0.)
        }
        _ => {
            let preferred = inline(sum.x > 0.1);
            let (l, r) = ((Side::Left, v2(-1., 0.)), (Side::Right, v2(1., 0.)));
            let order = if preferred == Side::Left { [l, r] } else { [r, l] };
            let mut best = (preferred, f64::INFINITY);
            for (side, c) in order.into_iter().chain([(Side::Above, v2(0., -1.)), (Side::Below, v2(0., 1.))]) {
                let score = dirs.iter().map(|d| d.dot(c)).fold(f64::NEG_INFINITY, f64::max);
                if score < best.1 - 1e-4 {
                    best = (side, score);
                }
            }
            best.0
        }
    }
}

fn charge_text(c: i8) -> String {
    let sign = if c > 0 { '+' } else { '−' };
    match c.unsigned_abs() {
        1 => sign.to_string(),
        n => format!("{n}{sign}"),
    }
}

/// Label of atom `i`, or `None` for skeletal carbons (a carbon with a valence
/// error, a radical or an unusual H count is labelled). The element symbol's
/// first letter is centred on the atom.
fn label(mol: &Mol, adj: &Adjacency, i: usize, v: Valence) -> Option<Label> {
    let a = &mol.atoms[i];
    let plain = a.charge == 0 && a.iso == 0 && a.radical == 0 && a.total.is_none_or(|t| t == 4);
    if a.el == 6 && plain && !adj[i].is_empty() && !v.error {
        return None;
    }
    let mut text = if let Some(alias) = &a.alias { alias.clone() } else { match (a.el, a.rgroup) {
        // A terminal bare `*` is an attachment point, drawn as a wavy line.
        (0, 0) if adj[i].len() == 1 => return None,
        (0, 0) => "*".to_string(),
        (0, r) => format!("R{r}"),
        (el, _) => symbol(el).to_string(),
    }};
    let mut h = v.h;
    if a.el == 1 && h > 0 {
        // Molecular hydrogen reads H2, not HH.
        text = "H".into();
        h += 1;
    }
    let side = if a.el != 1 && h > 0 { h_side(mol, adj, i) } else { Side::Right };
    let hydrogens = |runs: &mut Vec<(Script, String)>, count: u8| {
        runs.push((Script::Normal, "H".into()));
        if count > 1 {
            runs.push((Script::Sub, count.to_string()));
        }
    };
    let mut runs = Vec::with_capacity(5);
    if a.el != 1 && h > 0 && side == Side::Left {
        hydrogens(&mut runs, h);
    }
    if a.iso > 0 {
        runs.push((Script::Sup, a.iso.to_string()));
    }
    let at = runs.len();
    let first = text.chars().next().map_or(0., advance) * FONT;
    runs.push((Script::Normal, text));
    if a.el == 1 && h > 1 {
        runs.push((Script::Sub, h.to_string()));
    } else if h > 0 && side == Side::Right {
        hydrogens(&mut runs, h);
    }
    if a.radical != 0 {
        runs.push((Script::Charge, if a.radical == 2 { "•" } else { "••" }.into()));
    }
    if a.charge != 0 {
        runs.push((Script::Charge, charge_text(a.charge)));
    }
    let before: f64 = runs[..at].iter().map(|(s, t)| width(t, s.size())).sum();
    let base = a.pos.y + CAP * FONT / 2.;
    let mut lines = vec![Line { x: a.pos.x - before - first / 2., base, runs }];
    if a.el != 1 && h > 0 && matches!(side, Side::Above | Side::Below) {
        let mut runs = Vec::new();
        hydrogens(&mut runs, h);
        let dy = if side == Side::Above { -STACK } else { STACK } * FONT;
        lines.push(Line { x: a.pos.x - advance('H') * FONT / 2., base: base + dy, runs });
    }
    let mut boxes = Vec::with_capacity(6);
    for line in &lines {
        let mut x = line.x;
        for (script, t) in &line.runs {
            let size = script.size();
            let (w, y) = (width(t, size), line.base + script.shift());
            // Side bearings: trim against ink rather than the advance box.
            let inset = 0.04 * size;
            boxes.push((v2(x + inset, y - CAP * size), v2(x + w - inset, y)));
            x += w;
        }
    }
    let el = if a.el == 0 { "R" } else { symbol(a.el) };
    Some(Label { el, lines, boxes })
}

/// Label boxes of atom `i` where it stands now; empty for skeletal carbons.
pub fn label_boxes(mol: &Mol, adj: &Adjacency, i: usize) -> Vec<Box2> {
    label(mol, adj, i, valence(mol, adj, i)).map_or_else(Vec::new, |l| l.boxes)
}

// ------------------------------------------------------------------- scene

struct Scene<'a> {
    mol: &'a Mol,
    adj: Adjacency,
    labels: Vec<Option<Label>>,
    errors: Vec<bool>,
    rings: Vec<Vec<usize>>,
    ring_of: Vec<Vec<usize>>,
    /// Rings whose bonds are all displayed aromatic (drawn with a circle).
    aromatic: Vec<bool>,
    /// Terminal bare `*` atoms drawn as a wavy attachment line; the ends of
    /// polymer bonds leaving brackets are left open instead.
    attach: Vec<bool>,
}

fn bond_of(adj: &Adjacency, x: usize, y: usize) -> Option<usize> {
    adj[x].iter().find(|&&(_, n)| n == y).map(|&(b, _)| b)
}

impl<'a> Scene<'a> {
    fn new(mol: &'a Mol) -> Scene<'a> {
        let adj = mol.adjacency();
        let vals: Vec<Valence> = (0..mol.atoms.len()).map(|i| valence(mol, &adj, i)).collect();
        let labels = (0..mol.atoms.len()).map(|i| label(mol, &adj, i, vals[i])).collect();
        let (rings, ring_of) = rings(mol, &adj);
        let aromatic = rings
            .iter()
            .map(|r| {
                (0..r.len()).all(|k| bond_of(&adj, r[k], r[(k + 1) % r.len()]).is_some_and(|b| mol.bonds[b].arom))
            })
            .collect();
        let errors = vals.iter().map(|v| v.error).collect();
        let mut attach: Vec<bool> = (0..mol.atoms.len()).map(|i| mol.atoms[i].el == 0 && mol.atoms[i].rgroup == 0 && mol.atoms[i].alias.is_none() && adj[i].len() == 1).collect();
        for g in &mol.sgroups {
            g.crossing(mol).iter().for_each(|&(_, _, o)| attach[o] = false);
        }
        Scene { mol, adj, labels, errors, rings, ring_of, aromatic, attach }
    }

    fn boxes(&self, i: usize) -> &[(V2, V2)] {
        self.labels[i].as_ref().map_or(&[], |l| &l.boxes)
    }

    fn pos(&self, i: usize) -> V2 {
        self.mol.atoms[i].pos
    }

    /// Ring that receives the inner line of bond `bi`: most double bonds, then smallest.
    fn ring_for(&self, bi: usize) -> Option<usize> {
        let doubles = |r: &Vec<usize>| {
            (0..r.len())
                .filter(|&k| bond_of(&self.adj, r[k], r[(k + 1) % r.len()]).is_some_and(|b| self.mol.bonds[b].order == 2))
                .count()
        };
        self.ring_of[bi]
            .iter()
            .copied()
            .min_by_key(|&r| (usize::MAX - doubles(&self.rings[r]), self.rings[r].len()))
    }

    fn toward_ring(&self, bi: usize, n: V2) -> Option<f64> {
        let b = &self.mol.bonds[bi];
        let r = self.ring_for(bi)?;
        let mid = (self.pos(b.a) + self.pos(b.b)) * 0.5;
        Some(if (centroid(self.mol, &self.rings[r]) - mid).dot(n) >= 0. { 1. } else { -1. })
    }

    /// Offset side of a double bond's second line, `None` when centred.
    fn double_side(&self, bi: usize, n: V2) -> Option<f64> {
        if let Some(side) = self.toward_ring(bi, n) {
            return Some(side);
        }
        let b = &self.mol.bonds[bi];
        let mut count = [0i32; 2];
        let mut both = [false; 2];
        let mut lean = 0.;
        for (end, x, y) in [(0, b.a, b.b), (1, b.b, b.a)] {
            let (mut plus, mut minus) = (false, false);
            for &(_, k) in self.adj[x].iter().filter(|&&(_, k)| k != y) {
                let d = (self.pos(k) - self.pos(x)).unit().dot(n);
                lean += d;
                if d > 0.05 {
                    plus = true;
                    count[end] += 1;
                } else if d < -0.05 {
                    minus = true;
                    count[end] -= 1;
                }
            }
            if !plus && !minus {
                return None;
            }
            both[end] = plus && minus;
        }
        if both[0] && both[1] {
            return None;
        }
        let score = count[0] + count[1];
        Some(if score > 0 || (score == 0 && lean >= 0.) { 1. } else { -1. })
    }

    /// Parameter along `d` where the line `q + d·t` meets the centreline of
    /// the neighbour bond of unlabeled atom `x` (other than to `y`) that lies
    /// on the `side` half-plane and is angularly closest to the bond.
    fn meet(&self, x: usize, y: usize, q: V2, d: V2, side: V2) -> Option<f64> {
        if self.labels[x].is_some() {
            return None;
        }
        let px = self.pos(x);
        let along = (self.pos(y) - px).unit();
        let w = self.adj[x]
            .iter()
            .filter(|&&(_, k)| k != y)
            .map(|&(_, k)| (self.pos(k) - px).unit())
            .filter(|w| w.dot(side) > 0.05)
            .max_by(|a, b| a.dot(along).total_cmp(&b.dot(along)))?;
        let den = d.cross(w);
        if den.abs() < 1e-9 {
            return None;
        }
        let (t, r) = ((px - q).cross(w) / den, (px - q).cross(d) / den);
        (r > -1e-6).then_some(t)
    }
}

/// Distance along `u` from `origin` to the exit of the padded label boxes the
/// ray passes through (ReShiki `label_box_end`), at most `max`.
fn trim(origin: V2, u: V2, boxes: &[(V2, V2)], max: f64) -> f64 {
    let mut best: f64 = 0.;
    'boxes: for &(lo, hi) in boxes {
        let (mut enter, mut exit) = (0f64, max);
        for (p, d, l, h) in [(origin.x, u.x, lo.x - MARGIN, hi.x + MARGIN), (origin.y, u.y, lo.y - MARGIN, hi.y + MARGIN)] {
            if d.abs() < 1e-9 {
                if p < l || p > h {
                    continue 'boxes;
                }
            } else {
                let (a, b) = ((l - p) / d, (h - p) / d);
                enter = enter.max(a.min(b));
                exit = exit.min(a.max(b));
                if enter > exit {
                    continue 'boxes;
                }
            }
        }
        best = best.max(exit);
    }
    best
}

// ------------------------------------------------------------------ output

/// Appends `v` rounded to two decimals, without trailing zeros.
fn num(s: &mut String, v: f64) {
    let n = if v.is_finite() { (v * 100.).round() as i64 } else { 0 };
    if n < 0 {
        s.push('-');
    }
    let n = n.unsigned_abs();
    let (mut int, frac) = (n / 100, n % 100);
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (int % 10) as u8;
        int /= 10;
        if int == 0 {
            break;
        }
    }
    buf[i..].iter().for_each(|&c| s.push(c as char));
    if frac != 0 {
        s.push('.');
        s.push((b'0' + (frac / 10) as u8) as char);
        if frac % 10 != 0 {
            s.push((b'0' + (frac % 10) as u8) as char);
        }
    }
}

fn attr(s: &mut String, name: &str, v: f64) {
    s.push(' ');
    s.push_str(name);
    s.push_str("=\"");
    num(s, v);
    s.push('"');
}

fn pt(s: &mut String, view: &View, cmd: char, p: V2) {
    let q = view.screen(p);
    s.push(cmd);
    num(s, q.x);
    s.push(' ');
    num(s, q.y);
}

/// A path; stroked paths get `fill="none"` (a default any stylesheet overrides).
fn path(s: &mut String, class: &str, d: &str, stroke: Option<f64>, extra: &str) {
    if d.is_empty() {
        return;
    }
    s.push_str("<path class=\"");
    s.push_str(class);
    s.push_str("\" d=\"");
    s.push_str(d);
    s.push('"');
    if let Some(w) = stroke {
        attr(s, "stroke-width", w);
        s.push_str(" fill=\"none\"");
    }
    s.push_str(extra);
    s.push_str("/>");
}

#[derive(Default)]
struct Ink {
    lines: String,
    dative: String,
    dashes: String,
    wedges: String,
}

impl Ink {
    fn segment(&mut self, view: &View, a: V2, b: V2) {
        pt(&mut self.lines, view, 'M', a);
        pt(&mut self.lines, view, 'L', b);
    }
    fn flush(&self, s: &mut String, view: &View) {
        let w = (LINE * view.scale).max(0.5);
        path(s, "me-bond", &self.lines, Some(w), "");
        path(s, "me-bond me-dative", &self.dative, Some(w), "");
        let mut dash = String::from(" stroke-dasharray=\"");
        num(&mut dash, 0.05 * view.scale);
        dash.push(' ');
        num(&mut dash, 0.1 * view.scale);
        dash.push('"');
        path(s, "me-bond", &self.dashes, Some(w), &dash);
        path(s, "me-wedge", &self.wedges, None, "");
    }
}

fn draw_bond(sc: &Scene, bi: usize, view: &View, ink: &mut Ink) {
    let b = &sc.mol.bonds[bi];
    let (pa, pb) = (sc.pos(b.a), sc.pos(b.b));
    let len = pa.dist(pb);
    if len < 1e-3 {
        return;
    }
    let u = (pb - pa) * (1. / len);
    let n = u.perp();
    let ta = trim(pa, u, sc.boxes(b.a), len);
    let tb = trim(pb, -u, sc.boxes(b.b), len);
    if len - ta - tb < 0.02 {
        return;
    }
    let (p0, p1) = (pa + u * ta, pb - u * tb);
    if b.dative {
        // Open arrow at the acceptor, trimmed against the same atom labels
        // as an ordinary bond. No SVG markers or extra stylesheet needed.
        let head = 0.2f64.min((len - ta - tb) * 0.4);
        let d = &mut ink.dative;
        pt(d, view, 'M', p0);
        pt(d, view, 'L', p1);
        pt(d, view, 'M', p1 - u * head + n * (head * 0.5));
        pt(d, view, 'L', p1);
        pt(d, view, 'L', p1 - u * head - n * (head * 0.5));
        return;
    }
    // A line parallel to the bond: label-trimmed, shortened by `inner` after
    // the main line's ends, or mitred against neighbour bonds when centred.
    let rail = |off: f64, inner: f64, miter: bool| -> Option<(V2, V2)> {
        let (qa, qb) = (pa + n * off, pb + n * off);
        let (mut sa, mut sb) = (trim(qa, u, sc.boxes(b.a), len), trim(qb, -u, sc.boxes(b.b), len));
        if inner > 0. {
            sa = sa.max(ta + inner);
            sb = sb.max(tb + inner);
        }
        let side = n * off.signum();
        if miter {
            sa = sc.meet(b.a, b.b, qa, u, side).filter(|t| t.abs() < 0.4).unwrap_or(sa);
            sb = sc.meet(b.b, b.a, qb, -u, side).filter(|t| t.abs() < 0.4).unwrap_or(sb);
        }
        (len - sa - sb > 0.02).then(|| (qa + u * sa, qb - u * sb))
    };
    if b.arom {
        ink.segment(view, p0, p1);
        if !sc.ring_of[bi].iter().any(|&r| sc.aromatic[r]) {
            let side = sc.toward_ring(bi, n).unwrap_or(1.);
            if let Some((q0, q1)) = rail(SPACING * side, INNER_TRIM, false) {
                pt(&mut ink.dashes, view, 'M', q0);
                pt(&mut ink.dashes, view, 'L', q1);
            }
        }
        return;
    }
    match (b.order, b.stereo) {
        (1, Stereo::Wedge) => {
            let (q_plus, q_minus) = (p0 + n * (LINE / 2.), p0 - n * (LINE / 2.));
            let mut corners = [p1 + n * (BOLD / 2.), p1 - n * (BOLD / 2.)];
            for (c, q, s) in [(0, q_plus, 1.), (1, q_minus, -1.)] {
                let d = corners[c] - q;
                if let Some(t) = sc.meet(b.b, b.a, q, d, n * s).filter(|t| (0.7..1.4).contains(t)) {
                    corners[c] = q + d * t;
                }
            }
            let w = &mut ink.wedges;
            pt(w, view, 'M', q_plus);
            pt(w, view, 'L', corners[0]);
            pt(w, view, 'L', corners[1]);
            pt(w, view, 'L', q_minus);
            w.push('Z');
        }
        (1, Stereo::Hash) => {
            let l = len - ta - tb;
            let count = (l / HASH).floor().clamp(1., 400.) as usize;
            for i in 1..=count {
                let t = (i as f64 * HASH / l).min(1.);
                let p = p0.lerp(p1, t);
                let half = (LINE + t * (BOLD - LINE)) / 2.;
                ink.segment(view, p + n * half, p - n * half);
            }
        }
        (1, Stereo::Wavy) => {
            pt(&mut ink.lines, view, 'M', p0);
            for (c1, c2, e) in wave(p0, p1, 0.25, BOLD / 2.) {
                pt(&mut ink.lines, view, 'C', c1);
                pt(&mut ink.lines, view, ' ', c2);
                pt(&mut ink.lines, view, ' ', e);
            }
        }
        (2, Stereo::Wavy) => {
            // Either configuration: crossed lines.
            let h = n * (SPACING / 2.);
            ink.segment(view, p0 + h, p1 - h);
            ink.segment(view, p0 - h, p1 + h);
        }
        (2, _) => match sc.double_side(bi, n) {
            Some(side) => {
                ink.segment(view, p0, p1);
                if let Some((q0, q1)) = rail(SPACING * side, INNER_TRIM, false) {
                    ink.segment(view, q0, q1);
                }
            }
            None => {
                for off in [-SPACING / 2., SPACING / 2.] {
                    if let Some((q0, q1)) = rail(off, 0., true) {
                        ink.segment(view, q0, q1);
                    }
                }
            }
        },
        (3, _) => {
            ink.segment(view, p0, p1);
            for off in [-SPACING, SPACING] {
                if let Some((q0, q1)) = rail(off, 0., false) {
                    ink.segment(view, q0, q1);
                }
            }
        }
        _ => ink.segment(view, p0, p1),
    }
}

fn write_label(s: &mut String, view: &View, l: &Label, error: bool) {
    for line in &l.lines {
        let p = view.screen(v2(line.x, line.base));
        s.push_str("<text class=\"me-label me-el-");
        s.push_str(l.el);
        if error {
            s.push_str(" me-error");
        }
        s.push('"');
        attr(s, "x", p.x);
        attr(s, "y", p.y);
        attr(s, "font-size", FONT * view.scale);
        s.push('>');
        let mut shift = 0.;
        for (script, text) in &line.runs {
            let target = script.shift();
            if *script == Script::Normal && target == shift {
                s.push_str(text);
                continue;
            }
            s.push_str("<tspan");
            if *script == Script::Charge {
                s.push_str(" class=\"me-charge\"");
            }
            if target != shift {
                attr(s, "dy", (target - shift) * view.scale);
                shift = target;
            }
            if *script != Script::Normal {
                attr(s, "font-size", script.size() * view.scale);
            }
            s.push('>');
            s.push_str(text);
            s.push_str("</tspan>");
        }
        s.push_str("</text>");
    }
}

fn centred_text(s: &mut String, view: &View, class: &str, at: V2, size: f64, italic: bool, text: &str) {
    let p = view.screen(v2(at.x, at.y + CAP * size / 2.));
    s.push_str("<text class=\"");
    s.push_str(class);
    s.push('"');
    attr(s, "x", p.x);
    attr(s, "y", p.y);
    attr(s, "font-size", size * view.scale);
    s.push_str(" text-anchor=\"middle\"");
    if italic {
        s.push_str(" font-style=\"italic\"");
    }
    s.push('>');
    s.push_str(text);
    s.push_str("</text>");
}

/// Highlight of an item as a capsule: centre segment and radius.
fn halo(sc: &Scene, item: Item) -> Option<(V2, V2, f64)> {
    match item {
        Item::Bond(b) => {
            let b = sc.mol.bonds.get(b)?;
            Some((sc.pos(b.a), sc.pos(b.b), BOND_HALO))
        }
        Item::Atom(i) => {
            let p = sc.mol.atoms.get(i)?.pos;
            let Some(l) = sc.labels.get(i)?.as_ref() else { return Some((p, p, DOT)) };
            let (mut lo, mut hi) = (p, p);
            for (a, b) in &l.boxes {
                lo = v2(lo.x.min(a.x), lo.y.min(a.y));
                hi = v2(hi.x.max(b.x), hi.y.max(b.y));
            }
            let (lo, hi) = (lo - v2(PAD, PAD), hi + v2(PAD, PAD));
            let (w, h, c) = (hi.x - lo.x, hi.y - lo.y, (lo + hi) * 0.5);
            Some(if w >= h {
                (v2(lo.x + h / 2., c.y), v2(hi.x - h / 2., c.y), h / 2.)
            } else {
                (v2(c.x, lo.y + w / 2.), v2(c.x, hi.y - w / 2.), w / 2.)
            })
        }
    }
}

/// Appends a capsule around `a`–`b` (a circle when they coincide). Every
/// capsule winds the same way, so overlaps merge under the nonzero fill rule.
fn capsule(s: &mut String, view: &View, a: V2, b: V2, r: f64) {
    let n = (b - a).unit().perp() * r;
    let arc = |s: &mut String, to: V2| {
        s.push('A');
        num(s, r * view.scale);
        s.push(' ');
        num(s, r * view.scale);
        s.push_str(" 0 0 0");
        pt(s, view, ' ', to);
    };
    pt(s, view, 'M', a + n);
    pt(s, view, 'L', b + n);
    arc(s, b - n);
    pt(s, view, 'L', a - n);
    arc(s, a + n);
    s.push('Z');
}

/// Filled highlights of `items`, one path per class.
fn halos(s: &mut String, view: &View, sc: &Scene, class: &str, items: impl Iterator<Item = Item>) {
    let mut d = String::new();
    for (a, b, r) in items.filter_map(|it| halo(sc, it)) {
        capsule(&mut d, view, a, b, r);
    }
    path(s, class, &d, None, "");
}

/// Ink box of a CIP mark centred at `c`: the parentheses reach above the
/// caps and below the baseline, and the italic leans right.
fn mark_box(c: V2, text: &str) -> Box2 {
    let w = width(text, CIP_FONT) / 2.;
    (v2(c.x - w - 0.01, c.y - 0.38 * CIP_FONT), v2(c.x + w + 0.02, c.y + 0.57 * CIP_FONT))
}

/// Half the drawn width of a bond around its centre line.
fn ink_width(b: &Bond) -> f64 {
    if b.arom || b.order >= 2 {
        SPACING
    } else if b.stereo != Stereo::None {
        BOLD / 2.
    } else {
        LINE / 2.
    }
}

/// CIP marks (centre, text). Each takes the nearest spot beside its atom (or
/// its double bond) that clears every bond, label and earlier mark: free
/// sectors are searched outward from the atom, wider sectors and straighter
/// directions first and ring interiors last. When nothing clears, the spot
/// with the least overlap.
pub fn cip_marks(mol: &Mol, cip: &Cip) -> Vec<(V2, String)> {
    let sc = &Scene::new(mol);
    let mut marks: Vec<(V2, String)> = Vec::new();
    let mut boxes: Vec<Box2> = Vec::new();
    // Tries `spots` (offsets from `origin`) in order.
    let mut place = |origin: V2, text: String, spots: Vec<V2>| {
        let (lo, hi) = mark_box(v2(0., 0.), &text);
        let reach = spots.iter().map(|d| d.len()).fold(0., f64::max) + lo.len().max(hi.len());
        let area = (origin - v2(reach, reach), origin + v2(reach, reach));
        // Whether boxes `a` and `b` may be closer than `need`.
        let close = |a: Box2, b: Box2, need: f64| {
            a.0.x - b.1.x < need && b.0.x - a.1.x < need && a.0.y - b.1.y < need && b.0.y - a.1.y < need
        };
        // Bonds, labels and earlier marks that can come near, each with its
        // bounding box and the room it needs.
        let bonds: Vec<(V2, V2, Box2, f64)> = (mol.bonds.iter())
            .map(|b| (sc.pos(b.a), sc.pos(b.b), 0.05 + ink_width(b)))
            .map(|(a, b, need)| (a, b, (v2(a.x.min(b.x), a.y.min(b.y)), v2(a.x.max(b.x), a.y.max(b.y))), need))
            .filter(|&(_, _, bb, need)| close(area, bb, need))
            .collect();
        let labels: Vec<(Box2, f64)> = (0..mol.atoms.len())
            .flat_map(|i| sc.boxes(i).iter().map(|&l| (l, 0.06)))
            .chain(boxes.iter().map(|&m| (m, 0.04)))
            .filter(|&(l, need)| close(area, l, need))
            .collect();
        // How deep the box reaches into the room the others need, summed; 0
        // when it clears.
        let overlap = |bx: Box2| {
            let bond = (bonds.iter())
                .filter(|&&(_, _, bb, need)| close(bx, bb, need))
                .map(|&(a, b, _, need)| (need - box_segment_gap(bx, a, b)).max(0.));
            let label = (labels.iter())
                .filter(|&&(l, need)| close(bx, l, need))
                .map(|&(l, need)| (need - box_gap(bx, l)).max(0.));
            bond.chain(label).sum::<f64>()
        };
        let mut best = (f64::INFINITY, origin);
        for d in spots {
            let c = origin + d;
            let o = overlap((lo + c, hi + c));
            if o < best.0 {
                best = (o, c);
                if o == 0. {
                    break;
                }
            }
        }
        boxes.push((lo + best.1, hi + best.1));
        marks.push((best.1, text));
    };
    let radii = || (0..=30).map(|k| 0.3 + 0.05 * k as f64);
    for (i, d) in cip.0.iter().enumerate().take(mol.atoms.len()) {
        let Some(d) = d else { continue };
        let at = sc.pos(i);
        let inside: Vec<f64> = (sc.rings.iter())
            .filter(|r| r.contains(&i))
            .map(|r| (centroid(mol, r) - at).angle())
            .collect();
        // Directions every 10° across each sector, clear of its bonds;
        // costs in bond lengths.
        let mut spots: Vec<(f64, V2)> = Vec::new();
        for (rank, (start, size)) in sectors(&bond_angles(mol, i)).into_iter().enumerate() {
            let ring = inside.iter().any(|&c| (c - start).rem_euclid(TAU) < size);
            let extra = if ring { 0.5 } else { 0.1 * rank as f64 };
            for k in -17..=17 {
                let off = f64::to_radians(10. * k as f64);
                if k == 0 || off.abs() < size / 2. - 0.15 {
                    let d = V2::polar(start + size / 2. + off);
                    spots.extend(radii().map(|r| (r + extra + 0.2 * off.abs(), d * r)));
                }
            }
        }
        spots.sort_by(|a, b| a.0.total_cmp(&b.0));
        place(at, format!("({d})"), spots.into_iter().map(|s| s.1).collect());
    }
    for (bi, d) in cip.1.iter().enumerate().take(mol.bonds.len()) {
        let Some(d) = d else { continue };
        let b = &mol.bonds[bi];
        let (pa, pb) = (sc.pos(b.a), sc.pos(b.b));
        let n = (pb - pa).unit().perp();
        // Away from the second line, else from the substituents.
        let side = match sc.double_side(bi, n) {
            Some(side) => -side,
            None => {
                let mid = (pa + pb) * 0.5;
                let lean: f64 = [b.a, b.b]
                    .iter()
                    .flat_map(|&x| sc.adj[x].iter().map(|&(_, k)| (sc.pos(k) - mid).dot(n)))
                    .sum();
                if lean > 0. { -1. } else { 1. }
            }
        };
        let spots = [side, -side].into_iter().flat_map(|s| radii().map(move |r| n * (s * r)));
        place((pa + pb) * 0.5, format!("({d})"), spots.collect());
    }
    marks
}

/// Ink boxes of the CIP marks as drawn.
#[cfg(test)]
pub fn cip_boxes(mol: &Mol, cip: &Cip) -> Vec<Box2> {
    cip_marks(mol, cip).iter().map(|(c, t)| mark_box(*c, t)).collect()
}

// ---------------------------------------------------------------- polymers

/// One square bracket of a repeat unit: the line `a`–`b` with serifs at both
/// ends pointing `inward`, towards the unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bracket {
    pub a: V2,
    pub b: V2,
    pub inward: V2,
}

/// Half the length of a bracket and the length of its serifs.
const BRACKET: f64 = 0.45;
const SERIF: f64 = 0.14;
/// Gap between a bracket around the unit's sides and the unit's ink.
const BRACKET_GAP: f64 = 0.25;
const SRU_FONT: f64 = FONT * SMALL;
/// Wavy attachment line: half length, wavelength and amplitude.
const ATTACH: f64 = 0.32;
const ATTACH_WAVE: f64 = 0.16;
const ATTACH_AMPLITUDE: f64 = 0.055;

fn brackets_in(sc: &Scene, g: &SGroup) -> Vec<Bracket> {
    let mol = sc.mol;
    let crossing = g.crossing(mol);
    if let [_, _] = crossing[..] {
        // ACS style: square to each leaving bond, across its middle.
        return (crossing.iter())
            .map(|&(_, i, o)| {
                let (pi, po) = (sc.pos(i), sc.pos(o));
                let u = (po - pi).unit();
                let (c, n) = (pi.lerp(po, 0.5), u.perp() * BRACKET);
                Bracket { a: c - n, b: c + n, inward: -u }
            })
            .collect();
    }
    // Otherwise upright brackets beside the unit's ink.
    let inside = g.members(mol);
    let mut ink = (0..mol.atoms.len()).filter(|&i| inside[i]).flat_map(|i| {
        let p = sc.pos(i);
        sc.boxes(i).iter().copied().chain([(p, p)])
    });
    let Some(first) = ink.next() else { return vec![] };
    let (lo, hi) = ink.fold(first, |(lo, hi), (a, b)| (v2(lo.x.min(a.x), lo.y.min(a.y)), v2(hi.x.max(b.x), hi.y.max(b.y))));
    let (lo, hi) = (lo - v2(BRACKET_GAP, BRACKET_GAP), hi + v2(BRACKET_GAP, BRACKET_GAP));
    vec![
        Bracket { a: v2(lo.x, hi.y), b: v2(lo.x, lo.y), inward: v2(1., 0.) },
        Bracket { a: v2(hi.x, lo.y), b: v2(hi.x, hi.y), inward: v2(-1., 0.) },
    ]
}

/// The brackets of repeat unit `g` as drawn.
pub fn brackets(mol: &Mol, g: &SGroup) -> Vec<Bracket> {
    brackets_in(&Scene::new(mol), g)
}

/// Where the subscript of brackets `brs` starts (left end of its baseline):
/// at the lower right of the closing (rightmost) bracket.
fn bracket_label(brs: &[Bracket]) -> Option<V2> {
    let mid = |b: &Bracket| (b.a + b.b) * 0.5;
    let close = brs.iter().max_by(|x, y| (mid(x).x, mid(x).y).partial_cmp(&(mid(y).x, mid(y).y)).unwrap_or(std::cmp::Ordering::Equal))?;
    let low = if close.a.y >= close.b.y { close.a } else { close.b };
    let right = low.x.max(low.x - close.inward.x * SERIF);
    Some(v2(right + 0.06, low.y + CAP * SRU_FONT * 0.6))
}

/// Ink box of the subscript of brackets `brs` and `text`.
fn bracket_label_box(brs: &[Bracket], text: &str) -> Option<Box2> {
    let p = bracket_label(brs)?;
    Some((v2(p.x, p.y - CAP * SRU_FONT), v2(p.x + width(text, SRU_FONT), p.y)))
}

/// The repeat unit whose bracket or subscript lies within `radius` of `p`,
/// with its distance.
pub fn bracket_at(mol: &Mol, p: V2, radius: f64) -> Option<(usize, f64)> {
    if mol.sgroups.is_empty() {
        return None;
    }
    let sc = Scene::new(mol);
    (mol.sgroups.iter().enumerate())
        .flat_map(|(k, g)| {
            let brs = brackets_in(&sc, g);
            let label = bracket_label_box(&brs, &g.label).map(|bx| box_gap(bx, (p, p)));
            brs.iter().map(move |b| (k, segment_distance(p, b.a, b.b))).chain(label.map(|d| (k, d))).collect::<Vec<_>>()
        })
        .filter(|&(_, d)| d <= radius)
        .min_by(|x, y| x.1.total_cmp(&y.1))
}

/// Bounding box of atoms, label ink and polymer brackets, in model units.
pub fn extent(mol: &Mol) -> Option<(V2, V2)> {
    let (mut lo, mut hi) = mol.bounds()?;
    let sc = Scene::new(mol);
    let mut grow = |a: V2, b: V2| {
        lo = v2(lo.x.min(a.x), lo.y.min(a.y));
        hi = v2(hi.x.max(b.x), hi.y.max(b.y));
    };
    for (a, b) in sc.labels.iter().flatten().flat_map(|l| l.boxes.iter()) {
        grow(*a, *b);
    }
    for g in &mol.sgroups {
        let brs = brackets_in(&sc, g);
        for br in &brs {
            grow(v2(br.a.x.min(br.b.x), br.a.y.min(br.b.y)), v2(br.a.x.max(br.b.x), br.a.y.max(br.b.y)));
        }
        if let Some((a, b)) = bracket_label_box(&brs, &g.label) {
            grow(a, b);
        }
    }
    Some((lo, hi))
}

/// Wavy attachment lines across the ends of bonds to terminal `*` atoms
/// (from index `from` on), and the brackets of repeat units (from index
/// `groups_from` on) with their subscripts.
fn decorations(s: &mut String, view: &View, sc: &Scene, from: usize, groups_from: usize) {
    let mut d = String::new();
    for i in (from..sc.mol.atoms.len()).filter(|&i| sc.attach[i]) {
        let Some(&(_, n)) = sc.adj[i].first() else { continue };
        let p = sc.pos(i);
        let across = (p - sc.pos(n)).unit().perp() * ATTACH;
        let (a, b) = (p - across, p + across);
        pt(&mut d, view, 'M', a);
        for (c1, c2, e) in wave(a, b, ATTACH_WAVE, ATTACH_AMPLITUDE) {
            pt(&mut d, view, 'C', c1);
            pt(&mut d, view, ' ', c2);
            pt(&mut d, view, ' ', e);
        }
    }
    let w = (LINE * view.scale).max(0.5);
    path(s, "me-attach", &d, Some(w), "");
    let mut d = String::new();
    let mut labels = Vec::new();
    for g in sc.mol.sgroups.iter().skip(groups_from) {
        let brs = brackets_in(sc, g);
        for br in &brs {
            pt(&mut d, view, 'M', br.a + br.inward * SERIF);
            pt(&mut d, view, 'L', br.a);
            pt(&mut d, view, 'L', br.b);
            pt(&mut d, view, 'L', br.b + br.inward * SERIF);
        }
        if let Some(p) = bracket_label(&brs) {
            labels.push((p, g.label.as_str()));
        }
    }
    path(s, "me-bracket", &d, Some(w), "");
    for (p, text) in labels {
        let q = view.screen(p);
        s.push_str("<text class=\"me-label me-bracket-label\"");
        attr(s, "x", q.x);
        attr(s, "y", q.y);
        attr(s, "font-size", SRU_FONT * view.scale);
        s.push_str(" font-style=\"italic\">");
        escape(s, text);
        s.push_str("</text>");
    }
}

/// Appends `text` with XML special characters escaped.
fn escape(s: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '<' => s.push_str("&lt;"),
            '>' => s.push_str("&gt;"),
            '&' => s.push_str("&amp;"),
            '"' => s.push_str("&quot;"),
            c => s.push(c),
        }
    }
}

/// `mol` alone, fitted into `width` × `height` with a small padding and
/// centred; small drawings stay at the natural scale.
pub fn thumbnail(mol: &Mol, width: f64, height: f64) -> String {
    let (w, h) = (width.max(1.), height.max(1.));
    let mut view = View { scale: NATURAL_SCALE, offset: v2(w, h) * 0.5, width: w, height: h };
    if let Some((lo, hi)) = extent(mol) {
        let pad = (0.07 * w.min(h)).clamp(2., 12.);
        let size = hi - lo;
        let fit = ((w - 2. * pad) / size.x.max(1e-6)).min((h - 2. * pad) / size.y.max(1e-6));
        view.scale = fit.clamp(0.5, NATURAL_SCALE);
        view.offset = v2(w, h) * 0.5 - (lo + hi) * (0.5 * view.scale);
    }
    svg(mol, &view, &Overlay::default())
}

pub fn svg(mol: &Mol, view: &View, o: &Overlay) -> String {
    let sc = Scene::new(mol);
    let mut s = String::with_capacity(1024 + mol.bonds.len() * 96 + mol.atoms.len() * 64);
    s.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\"");
    attr(&mut s, "width", view.width);
    attr(&mut s, "height", view.height);
    s.push_str(" viewBox=\"0 0 ");
    num(&mut s, view.width);
    s.push(' ');
    num(&mut s, view.height);
    s.push_str("\" class=\"me-canvas\" stroke-linecap=\"round\" stroke-linejoin=\"round\">");

    // Transparent anchors let host overlays track every atom, including
    // implicit carbons, without guessing positions from labels or bonds.
    for (index, atom) in mol.atoms.iter().enumerate() {
        let p = view.screen(atom.pos);
        s.push_str(&format!("<circle data-atom-id=\"{}\" data-selected=\"{}\" aria-hidden=\"true\" fill=\"none\" stroke=\"none\" pointer-events=\"none\"", index, o.atoms.get(index).copied().unwrap_or(false)));
        attr(&mut s, "cx", p.x);
        attr(&mut s, "cy", p.y);
        s.push_str(" r=\"1\"/>");
    }

    let selected = o.atoms.iter().enumerate().filter(|x| *x.1).map(|(i, _)| Item::Atom(i));
    let selected_bonds = o.bonds.iter().enumerate().filter(|x| *x.1).map(|(i, _)| Item::Bond(i));
    halos(&mut s, view, &sc, "me-selected", selected_bonds.chain(selected));
    halos(&mut s, view, &sc, "me-hover", o.hover.into_iter());
    if let Some(g) = o.bracket.and_then(|k| mol.sgroups.get(k)) {
        let mut d = String::new();
        for br in brackets_in(&sc, g) {
            capsule(&mut d, view, br.a, br.b, BOND_HALO);
        }
        path(&mut s, "me-hover", &d, None, "");
    }

    let mut ink = Ink::default();
    for bi in 0..mol.bonds.len() {
        draw_bond(&sc, bi, view, &mut ink);
    }
    ink.flush(&mut s, view);
    decorations(&mut s, view, &sc, 0, 0);
    for ring in sc.rings.iter().zip(&sc.aromatic).filter(|x| *x.1).map(|x| x.0) {
        let c = centroid(mol, ring);
        let inradius = (0..ring.len())
            .map(|k| {
                let (a, b) = (mol.atoms[ring[k]].pos, mol.atoms[ring[(k + 1) % ring.len()]].pos);
                ((c - a).cross(b - a) / a.dist(b).max(1e-9)).abs()
            })
            .fold(f64::INFINITY, f64::min);
        let p = view.screen(c);
        s.push_str("<circle class=\"me-ring-circle\"");
        attr(&mut s, "cx", p.x);
        attr(&mut s, "cy", p.y);
        attr(&mut s, "r", 0.6 * inradius * view.scale);
        attr(&mut s, "stroke-width", (LINE * view.scale).max(0.5));
        s.push_str(" fill=\"none\"/>");
    }
    for (i, l) in sc.labels.iter().enumerate() {
        if let Some(l) = l {
            write_label(&mut s, view, l, sc.errors[i]);
        }
    }
    for (at, text) in o.cip.unwrap_or_default() {
        centred_text(&mut s, view, "me-cip", *at, CIP_FONT, true, text);
    }
    if let Some(p) = o.preview {
        let ps = Scene::new(&p.mol);
        s.push_str("<g class=\"me-preview\">");
        let mut ink = Ink::default();
        for bi in p.bonds_from..p.mol.bonds.len() {
            draw_bond(&ps, bi, view, &mut ink);
        }
        ink.flush(&mut s, view);
        decorations(&mut s, view, &ps, p.atoms_from, p.sgroups_from);
        for l in ps.labels.iter().skip(p.atoms_from).flatten() {
            write_label(&mut s, view, l, false);
        }
        if let Some((at, text)) = &p.note {
            centred_text(&mut s, view, "me-label me-count", *at, CIP_FONT, false, text);
        }
        s.push_str("</g>");
    }
    if let Some((a, b)) = o.marquee {
        let (p, q) = (view.screen(a), view.screen(b));
        s.push_str("<rect class=\"me-marquee\"");
        attr(&mut s, "x", p.x.min(q.x));
        attr(&mut s, "y", p.y.min(q.y));
        attr(&mut s, "width", (p.x - q.x).abs());
        attr(&mut s, "height", (p.y - q.y).abs());
        s.push_str("/>");
    }
    s.push_str("</svg>");
    s
}
