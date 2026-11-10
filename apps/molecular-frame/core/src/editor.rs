//! The editor core behind the WebAssembly API: drawing, history, view,
//! selection and pointer gestures. Errors are short user-facing messages.
use crate::chem;
use crate::geometry::{DEFAULT_ANGLE, V2, box_gap, new_bond_angle, segment_distance, snap, v2};
use crate::model::{Item, Mol, SGroup};
use crate::render::{self, Cip, NATURAL_SCALE, Overlay, Preview, View};
use crate::template::{self, Template};
use crate::tools::{self, BondKind, MERGE, Tool};
use std::cell::Cell;
use std::f64::consts::PI;

const MIN_SCALE: f64 = NATURAL_SCALE * 0.25;
const MAX_SCALE: f64 = NATURAL_SCALE * 4.;
/// Zoom-in and zoom-out stops, as fractions of the natural scale.
const ZOOM_STEPS: [f64; 16] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1., 1.1, 1.25, 1.5, 1.75, 2., 2.5, 3., 4.];
const HISTORY: usize = 200;
/// Pointer travel (px) that turns a press into a drag.
const DRAG_PX: f64 = 3.;
/// Releasing a new bond this close to an atom (bond lengths) connects to it.
const TARGET: f64 = 0.35;

enum Drag {
    Pan { last: V2 },
    Marquee { start: V2, end: V2, atoms: Vec<bool>, bonds: Vec<bool> },
    Move { base: Mol, atoms: Vec<usize>, origin: Vec<V2>, start: V2, moved: bool, click: Option<Item> },
    Erase { base: Mol, changed: bool },
    Draw { hit: Option<Item>, start: V2, screen: V2, moved: bool },
    /// Polymer tool: a marquee around a repeat unit, or a click on the
    /// brackets of unit `group`.
    Bracket { start: V2, end: V2, screen: V2, moved: bool, group: Option<usize> },
}

pub struct Editor {
    mol: Mol,
    undo: Vec<Mol>,
    redo: Vec<Mol>,
    revision: u32,
    view: View,
    fit_on_resize: bool,
    tool: Tool,
    atoms: Vec<bool>,
    highlighted_atoms: Vec<bool>,
    bonds: Vec<bool>,
    hover: Option<Item>,
    /// Repeat unit whose brackets are under the pointer (polymer and erase tools).
    bracket: Option<usize>,
    pointer: Option<V2>,
    alt: bool,
    drag: Option<Drag>,
    preview: Option<Preview>,
    /// CIP labels, present while they are shown.
    cip: Option<Cip>,
    /// CIP marks and the drawing they were placed on: placement is a search,
    /// so frames that only move the pointer reuse it.
    marks: Cell<Option<(Mol, Vec<(V2, String)>)>>,
    /// The template tool's template.
    template: Option<Template>,
    /// Why the last command or action could not run; cleared by the next
    /// successful change or command.
    message: String,
}

impl Default for Editor {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether explicit hydrogens are on: the ones the command would remove.
fn explicit_h(mol: &Mol) -> bool {
    chem::removable_hydrogens(mol).contains(&true)
}

fn same_graph(a: &Mol, b: &Mol) -> bool {
    let key = |x: &crate::model::Atom| (x.el, x.charge, x.iso, x.rgroup, x.total, x.radical);
    a.atoms.len() == b.atoms.len()
        && a.bonds.len() == b.bonds.len()
        && a.atoms.iter().zip(&b.atoms).all(|(x, y)| key(x) == key(y) && x.alias == y.alias)
        && a.bonds.iter().zip(&b.bonds).all(|(x, y)| (x.a, x.b, x.order, x.dative) == (y.a, y.b, y.order, y.dative))
}

impl Editor {
    pub fn new() -> Editor {
        Editor {
            mol: Mol::default(),
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            view: View { scale: NATURAL_SCALE, offset: V2::default(), width: 0., height: 0. },
            fit_on_resize: true,
            tool: Tool::Bond(BondKind::Single),
            atoms: Vec::new(),
            highlighted_atoms: Vec::new(),
            bonds: Vec::new(),
            hover: None,
            bracket: None,
            pointer: None,
            alt: false,
            drag: None,
            preview: None,
            cip: None,
            marks: Cell::new(None),
            template: None,
            message: String::new(),
        }
    }

    // ------------------------------------------------------------ history

    fn push_undo(&mut self, m: Mol) {
        self.undo.push(m);
        if self.undo.len() > HISTORY {
            self.undo.remove(0);
        }
    }

    /// After every model change: revision, selection sizes, CIP and hover.
    fn changed(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.message.clear();
        self.highlighted_atoms.clear();
        let (na, nb) = (self.mol.atoms.len(), self.mol.bonds.len());
        if self.atoms.len() > na || self.bonds.len() > nb {
            self.atoms.clear();
            self.bonds.clear();
        }
        self.atoms.resize(na, false);
        self.bonds.resize(nb, false);
        if self.cip.is_some() {
            self.cip = Some(chem::cip_labels(&self.mol).unwrap_or_default());
        }
        self.update_hover();
    }

    /// Records the live drawing as an undo step after `base`. Aromatic display
    /// is re-perceived when the graph changed while it was on.
    fn finish(&mut self, base: Mol, refresh: bool) -> bool {
        if self.mol == base {
            return false;
        }
        if refresh
            && base.bonds.iter().any(|b| b.arom)
            && !same_graph(&base, &self.mol)
            && let Ok(flags) = chem::aromatic_bonds(&self.mol)
        {
            self.mol.bonds.iter_mut().zip(flags).for_each(|(b, f)| b.arom = f);
        }
        self.push_undo(base);
        self.redo.clear();
        self.changed();
        true
    }

    fn commit(&mut self, next: Mol) -> bool {
        let base = std::mem::replace(&mut self.mol, next);
        self.finish(base, true)
    }

    fn step(&mut self, back: bool) -> bool {
        self.cancel_drag();
        let (from, to) = if back { (&mut self.undo, &mut self.redo) } else { (&mut self.redo, &mut self.undo) };
        let Some(m) = from.pop() else { return false };
        to.push(std::mem::replace(&mut self.mol, m));
        self.atoms.clear();
        self.bonds.clear();
        self.changed();
        true
    }

    // --------------------------------------------------------------- view

    pub fn resize(&mut self, width: f64, height: f64) {
        if !(width.is_finite() && height.is_finite()) {
            return;
        }
        let (w, h) = (width.max(0.), height.max(0.));
        self.view.offset = self.view.offset + v2(w - self.view.width, h - self.view.height) * 0.5;
        (self.view.width, self.view.height) = (w, h);
        if self.fit_on_resize {
            self.fit();
        }
    }

    fn fit(&mut self) -> bool {
        let (w, h) = (self.view.width, self.view.height);
        self.fit_on_resize = true;
        let Some((lo, hi)) = render::extent(&self.mol) else {
            self.view.scale = NATURAL_SCALE;
            self.view.offset = v2(w, h) * 0.5;
            return true;
        };
        // Compact frames move the side rails to the bottom. Use the remaining
        // canvas width instead of reserving space for absent side rails.
        let horizontal_padding: f64 = if w <= 600. { 16. } else { 60. };
        let pad = v2(horizontal_padding.min(0.3 * w), 60_f64.min(0.3 * h));
        let size = hi - lo;
        let scale = ((w - 2. * pad.x) / size.x.max(1e-6)).min((h - 2. * pad.y) / size.y.max(1e-6));
        // Fill the available area within the editor's supported zoom range.
        self.view.scale = scale.clamp(MIN_SCALE, MAX_SCALE);
        self.view.offset = v2(w, h) * 0.5 - (lo + hi) * (0.5 * self.view.scale);
        self.update_hover();
        true
    }

    /// The next zoom stop above (`up`) or below the current scale.
    fn zoom_step(&self, up: bool) -> f64 {
        let z = self.view.scale / NATURAL_SCALE;
        let next = if up {
            ZOOM_STEPS.iter().copied().find(|&s| s > z * 1.02)
        } else {
            ZOOM_STEPS.iter().rev().copied().find(|&s| s < z / 1.02)
        };
        next.unwrap_or(z) * NATURAL_SCALE / self.view.scale
    }

    fn zoom_at(&mut self, p: V2, factor: f64) -> bool {
        let scale = (self.view.scale * factor).clamp(MIN_SCALE, MAX_SCALE);
        if !scale.is_finite() || (scale - self.view.scale).abs() < 1e-9 {
            return false;
        }
        let m = self.view.model(p);
        self.fit_on_resize = false;
        self.view.scale = scale;
        self.view.offset = p - m * scale;
        self.update_hover();
        true
    }

    pub fn zoom_by(&mut self, factor: f64) -> bool {
        factor.is_finite() && factor > 0. && self.zoom_at(self.center(), factor)
    }

    fn center(&self) -> V2 {
        v2(self.view.width, self.view.height) * 0.5
    }

    // ---------------------------------------------------------- selection

    fn selected(&self, it: Item) -> bool {
        match it {
            Item::Atom(i) => self.atoms.get(i).copied().unwrap_or(false),
            Item::Bond(b) => self.bonds.get(b).copied().unwrap_or(false),
        }
    }

    fn flag(&mut self, it: Item, on: bool) {
        let slot = match it {
            Item::Atom(i) => self.atoms.get_mut(i),
            Item::Bond(b) => self.bonds.get_mut(b),
        };
        if let Some(s) = slot {
            *s = on;
        }
    }

    fn clear_selection(&mut self) -> bool {
        let any = self.atoms.iter().chain(&self.bonds).any(|&x| x);
        self.atoms.iter_mut().chain(self.bonds.iter_mut()).for_each(|x| *x = false);
        any
    }

    fn select_all(&mut self) -> bool {
        self.atoms.iter_mut().chain(self.bonds.iter_mut()).for_each(|x| *x = true);
        !self.mol.is_empty()
    }

    /// Atoms that a drag of `it` moves.
    fn moving_atoms(&self, it: Item) -> Vec<usize> {
        let mut set = vec![false; self.mol.atoms.len()];
        if self.selected(it) {
            for (x, &s) in set.iter_mut().zip(&self.atoms) {
                *x |= s;
            }
            for (b, _) in self.mol.bonds.iter().zip(&self.bonds).filter(|x| *x.1) {
                (set[b.a], set[b.b]) = (true, true);
            }
        } else {
            match it {
                Item::Atom(i) => set[i] = true,
                Item::Bond(b) => (set[self.mol.bonds[b].a], set[self.mol.bonds[b].b]) = (true, true),
            }
        }
        (0..set.len()).filter(|&i| set[i]).collect()
    }

    fn delete(&mut self, atoms: &[bool], bonds: &[bool]) -> bool {
        match tools::erase(&self.mol, atoms, bonds) {
            Some(m) => self.commit(m),
            None => false,
        }
    }

    fn delete_item(&mut self, it: Item) -> bool {
        let (mut a, mut b) = (vec![false; self.mol.atoms.len()], vec![false; self.mol.bonds.len()]);
        match it {
            Item::Atom(i) => a[i] = true,
            Item::Bond(j) => b[j] = true,
        }
        self.delete(&a, &b)
    }

    // ------------------------------------------------------------ gestures

    /// The item under screen point `p`. In order: an atom whose label the
    /// point is on or whose centre is close, a bond near its middle, then an
    /// atom a little farther out. Radii have floors in screen pixels, so
    /// targets stay comfortable at 100 % and below, and caps in bond lengths,
    /// so bonds stay reachable between their atoms.
    fn hit(&self, p: V2) -> Option<Item> {
        let (m, s) = (self.view.model(p), self.view.scale);
        let (mol, px) = (&self.mol, |n: f64| n / s);
        let adj = mol.adjacency();
        let pad = px(3.).min(0.15);
        let on_label = (0..mol.atoms.len())
            .filter(|&i| mol.atoms[i].pos.dist(m) < 2.5)
            .filter(|&i| render::label_boxes(mol, &adj, i).iter().any(|&b| box_gap(b, (m, m)) <= pad))
            .min_by(|&i, &j| mol.atoms[i].pos.dist(m).total_cmp(&mol.atoms[j].pos.dist(m)));
        if let Some(i) = on_label.or_else(|| mol.nearest_atom(m, px(6.).max(0.3).min(0.45))) {
            return Some(Item::Atom(i));
        }
        if let Some(b) = mol.nearest_bond(m, px(8.).max(0.25).min(0.4)) {
            return Some(Item::Bond(b));
        }
        // Tools that drop a lone atom never stack one onto another: a near
        // miss targets the atom.
        let lone = matches!(self.tool, Tool::Atom(_) | Tool::RGroup(_));
        let reach = if lone { px(10.).max(0.75).min(1.) } else { px(10.).max(0.45).min(0.8) };
        mol.nearest_atom(m, reach).map(Item::Atom)
    }

    /// The edit of the current tool for a click (`cursor` = None) or a drag
    /// from `start` on `hit`, with an optional note for the preview.
    fn plan(&self, hit: Option<Item>, start: V2, cursor: Option<V2>) -> Option<(Mol, Option<(V2, String)>)> {
        let mol = &self.mol;
        let atom = match hit {
            Some(Item::Atom(i)) if i < mol.atoms.len() => Some(i),
            Some(Item::Bond(b)) if b >= mol.bonds.len() => return None,
            Some(Item::Atom(_)) => return None,
            _ => None,
        };
        let from = atom.map_or(start, |i| mol.atoms[i].pos);
        // A fixed-length bond towards `c` (15° steps unless Alt), or to the atom under it.
        let towards = |c: V2| {
            let target = mol.nearest_atom(c, TARGET).filter(|&j| Some(j) != atom);
            let mut angle = (c - from).angle();
            if !self.alt {
                angle = snap(angle, PI / 12.);
            }
            (from + V2::polar(angle), target)
        };
        let click_bond = |kind: BondKind| match (hit, atom) {
            (Some(Item::Bond(b)), _) => tools::set_bond(mol, b, kind),
            (_, Some(i)) => tools::add_bond(mol, Some(i), from, from + V2::polar(new_bond_angle(mol, i)), None, kind, 6),
            _ => tools::add_bond(mol, None, start, start + V2::polar(DEFAULT_ANGLE), None, kind, 6),
        };
        let edit = match self.tool {
            Tool::Bond(kind) => match cursor {
                Some(c) if !matches!(hit, Some(Item::Bond(_))) => {
                    let (end, target) = towards(c);
                    tools::add_bond(mol, atom, from, end, target, kind, 6)
                }
                _ => click_bond(kind),
            },
            Tool::Atom(el) => match (atom, cursor, hit) {
                (Some(i), Some(c), _) => {
                    let (end, target) = towards(c);
                    tools::add_bond(mol, Some(i), from, end, target, BondKind::Single, el)
                }
                (Some(i), None, _) => tools::set_element(mol, i, el),
                (None, _, None) => Some(tools::add_atom(mol, el, start, None)),
                _ => None,
            },
            // Chains are dragged out; a click adds nothing, so a click before
            // the drag leaves no stray bond on the start atom.
            Tool::Chain => match cursor {
                Some(c) if !matches!(hit, Some(Item::Bond(_))) => {
                    let (m, count) = tools::chain(mol, atom, from, c, !self.alt)?;
                    return Some((m, Some((c + v2(0.4, -0.4), count.to_string()))));
                }
                _ => None,
            },
            Tool::Ring(kind) => tools::ring(mol, kind, start, hit),
            Tool::Charge(d) => atom.and_then(|i| tools::add_charge(mol, i, d)),
            Tool::RGroup(n) => match (atom, hit) {
                (Some(i), _) => tools::rgroup(mol, i, n),
                (None, None) => Some(tools::add_atom(mol, 0, start, Some(n.unwrap_or(0)))),
                _ => None,
            },
            Tool::Attach => atom.and_then(|i| {
                let dir = match cursor {
                    Some(c) if c.dist(from) > 0.3 => self.turn(from, c),
                    _ => new_bond_angle(mol, i),
                };
                tools::attach(mol, i, dir)
            }),
            Tool::Template => self.place_template(hit, start, cursor),
            Tool::Hand | Tool::Select | Tool::Erase | Tool::Polymer => None,
        };
        edit.map(|m| (m, None))
    }

    /// Direction from `from` to `c` in 15° steps (free with Alt).
    fn turn(&self, from: V2, c: V2) -> f64 {
        let a = (c - from).angle();
        if self.alt { a } else { snap(a, PI / 12.) }
    }

    /// The template tool's edit (Ketcher's semantics): a click places the
    /// template on the canvas, shares a clicked atom or fuses on a clicked
    /// bond; dragging turns it, dragging out of an atom by more than a bond
    /// attaches it through a new bond, and dragging across a bond picks the
    /// side it fuses on.
    fn place_template(&self, hit: Option<Item>, start: V2, cursor: Option<V2>) -> Option<Mol> {
        let t = self.template.as_ref()?;
        let mol = &self.mol;
        let cursor = cursor.filter(|c| c.dist(start) > 0.3);
        match (hit, cursor) {
            (Some(Item::Bond(b)), c) if t.bond.is_some() => template::on_bond(mol, t, b, c),
            (Some(Item::Atom(i)), None) if t.atom.is_some() => template::on_atom(mol, t, i, None, false),
            (Some(Item::Atom(i)), Some(c)) if t.atom.is_some() => {
                let p = mol.atoms[i].pos;
                template::on_atom(mol, t, i, Some(self.turn(p, c)), t.group || c.dist(p) > 1.)
            }
            (_, Some(c)) => template::on_canvas(mol, t, start, self.turn(start, c)),
            _ => template::on_canvas(mol, t, start, 0.),
        }
    }

    fn preview_of(&self, plan: Option<(Mol, Option<(V2, String)>)>) -> Option<Preview> {
        let (mol, note) = plan?;
        let (atoms_from, bonds_from) = (self.mol.atoms.len(), self.mol.bonds.len());
        let sgroups_from = mol.sgroups.len();
        // Only appended structure is previewed; in-place changes apply on click.
        (mol.bonds.len() > bonds_from || mol.atoms.len() > atoms_from).then_some(Preview { mol, atoms_from, bonds_from, sgroups_from, note })
    }

    /// The repeat unit whose brackets (or subscript) are under screen point
    /// `p`, unless `hit` comes first: an atom, or a bond nearer than the
    /// bracket (a bracket crosses its bond in the middle).
    fn bracket_hit(&self, p: V2, hit: Option<Item>) -> Option<usize> {
        if self.mol.sgroups.is_empty() {
            return None;
        }
        let m = self.view.model(p);
        let (k, d) = render::bracket_at(&self.mol, m, (6. / self.view.scale).max(0.2).min(0.35))?;
        match hit {
            Some(Item::Atom(_)) => None,
            Some(Item::Bond(b)) => {
                let bd = &self.mol.bonds[b];
                (d + 1e-6 < segment_distance(m, self.mol.atoms[bd.a].pos, self.mol.atoms[bd.b].pos)).then_some(k)
            }
            None => Some(k),
        }
    }

    /// The item and the repeat unit (by its brackets) the current tool
    /// targets at screen point `p`; at most one of them.
    fn targets(&self, p: V2) -> (Option<Item>, Option<usize>) {
        match self.tool {
            Tool::Hand => (None, None),
            Tool::Polymer => (None, self.bracket_hit(p, None)),
            Tool::Erase => {
                let hit = self.hit(p);
                match self.bracket_hit(p, hit) {
                    Some(k) => (None, Some(k)),
                    None => (hit, None),
                }
            }
            _ => (self.hit(p), None),
        }
    }

    /// The drawing with the atoms inside the rectangle `a`–`b` wrapped in
    /// polymer brackets, replacing units that share atoms with them; `None`
    /// when no atom is inside.
    fn wrapped(&self, a: V2, b: V2) -> Option<Mol> {
        let (lo, hi) = (v2(a.x.min(b.x), a.y.min(b.y)), v2(a.x.max(b.x), a.y.max(b.y)));
        let inside = |p: V2| p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
        let atoms: Vec<usize> = (0..self.mol.atoms.len()).filter(|&i| inside(self.mol.atoms[i].pos)).collect();
        if atoms.is_empty() {
            return None;
        }
        let mut next = self.mol.clone();
        if next.sgroups.iter().any(|g| g.atoms == atoms) {
            return Some(next);
        }
        next.sgroups.retain(|g| !g.atoms.iter().any(|i| atoms.contains(i)));
        next.sgroups.push(SGroup::new(atoms));
        Some(next)
    }

    fn update_hover(&mut self) -> bool {
        if self.drag.is_some() {
            return false;
        }
        let (hit, bracket) = self.pointer.map_or((None, None), |p| self.targets(p));
        let preview = match (self.tool, self.pointer) {
            (Tool::Ring(_) | Tool::Template, Some(p)) => self.preview_of(self.plan(hit, self.view.model(p), None)),
            (Tool::Bond(_) | Tool::Attach, Some(p)) if matches!(hit, Some(Item::Atom(_))) => {
                self.preview_of(self.plan(hit, self.view.model(p), None))
            }
            _ => None,
        };
        let changed = hit != self.hover || preview != self.preview || bracket != self.bracket;
        (self.hover, self.preview, self.bracket) = (hit, preview, bracket);
        changed
    }

    fn erase_at(&mut self, p: V2) -> bool {
        let (hit, bracket) = self.targets(p);
        if let Some(k) = bracket {
            self.mol.sgroups.remove(k);
            self.bracket = None;
            return true;
        }
        let Some(it) = hit else { return false };
        let (mut a, mut b) = (vec![false; self.mol.atoms.len()], vec![false; self.mol.bonds.len()]);
        match it {
            Item::Atom(i) => a[i] = true,
            Item::Bond(j) => b[j] = true,
        }
        match tools::erase(&self.mol, &a, &b) {
            Some(m) => {
                self.mol = m;
                self.atoms.clear();
                self.bonds.clear();
                self.atoms.resize(self.mol.atoms.len(), false);
                self.bonds.resize(self.mol.bonds.len(), false);
                self.hover = None;
                true
            }
            None => false,
        }
    }

    fn cancel_drag(&mut self) -> bool {
        let Some(drag) = self.drag.take() else { return false };
        match drag {
            Drag::Move { base, .. } | Drag::Erase { base, .. } => {
                self.mol = base;
                self.atoms.resize(self.mol.atoms.len(), false);
                self.bonds.resize(self.mol.bonds.len(), false);
            }
            Drag::Marquee { atoms, bonds, .. } => (self.atoms, self.bonds) = (atoms, bonds),
            Drag::Pan { .. } | Drag::Draw { .. } | Drag::Bracket { .. } => {}
        }
        self.preview = None;
        self.update_hover();
        true
    }

    fn cancel(&mut self) -> bool {
        self.cancel_drag() || self.clear_selection() || self.preview.take().is_some()
    }

    pub fn set_tool(&mut self, id: &str) {
        if let Some(tool) = Tool::parse(id) {
            self.cancel_drag();
            self.tool = tool;
            self.update_hover();
        }
    }

    pub fn pointer_down(&mut self, x: f64, y: f64, button: u8, shift: bool, alt: bool) -> bool {
        let p = v2(x, y);
        if !p.finite() {
            return false;
        }
        self.cancel_drag();
        (self.pointer, self.alt) = (Some(p), alt);
        if button == 1 || (button == 0 && self.tool == Tool::Hand) {
            self.drag = Some(Drag::Pan { last: p });
            return true;
        }
        if button != 0 {
            return false;
        }
        let (hit, m) = (self.hit(p), self.view.model(p));
        self.hover = hit;
        match self.tool {
            Tool::Select => {
                self.preview = None;
                match hit {
                    Some(it) if shift => {
                        let on = !self.selected(it);
                        self.flag(it, on);
                    }
                    Some(it) => {
                        let atoms = self.moving_atoms(it);
                        let origin = atoms.iter().map(|&i| self.mol.atoms[i].pos).collect();
                        let click = (!self.selected(it)).then_some(it);
                        self.drag = Some(Drag::Move { base: self.mol.clone(), atoms, origin, start: m, moved: false, click });
                    }
                    None => {
                        if !shift {
                            self.clear_selection();
                        }
                        let (atoms, bonds) = (self.atoms.clone(), self.bonds.clone());
                        self.drag = Some(Drag::Marquee { start: m, end: m, atoms, bonds });
                    }
                }
            }
            Tool::Erase => {
                let base = self.mol.clone();
                let changed = self.erase_at(p);
                self.drag = Some(Drag::Erase { base, changed });
            }
            Tool::Polymer => {
                (self.hover, self.preview) = (None, None);
                let group = self.bracket_hit(p, None);
                self.drag = Some(Drag::Bracket { start: m, end: m, screen: p, moved: false, group });
            }
            _ => self.drag = Some(Drag::Draw { hit, start: m, screen: p, moved: false }),
        }
        true
    }

    pub fn pointer_move(&mut self, x: f64, y: f64, buttons: u8, _shift: bool, alt: bool) -> bool {
        let p = v2(x, y);
        if !p.finite() {
            return false;
        }
        (self.pointer, self.alt) = (Some(p), alt);
        let Some(mut drag) = self.drag.take() else { return self.update_hover() };
        if buttons == 0 {
            // The button went up outside the canvas.
            self.drag = Some(drag);
            return self.pointer_up(x, y);
        }
        let m = self.view.model(p);
        let changed = match &mut drag {
            Drag::Pan { last } => {
                self.fit_on_resize = false;
                self.view.offset = self.view.offset + (p - *last);
                *last = p;
                true
            }
            Drag::Marquee { start, end, atoms, bonds } => {
                *end = m;
                let (lo, hi) = (v2(start.x.min(m.x), start.y.min(m.y)), v2(start.x.max(m.x), start.y.max(m.y)));
                let inside: Vec<bool> = (self.mol.atoms.iter())
                    .map(|a| a.pos.x >= lo.x && a.pos.x <= hi.x && a.pos.y >= lo.y && a.pos.y <= hi.y)
                    .collect();
                for (i, s) in self.atoms.iter_mut().enumerate() {
                    *s = atoms.get(i).copied().unwrap_or(false) || inside[i];
                }
                for (i, s) in self.bonds.iter_mut().enumerate() {
                    let b = &self.mol.bonds[i];
                    *s = bonds.get(i).copied().unwrap_or(false) || (inside[b.a] && inside[b.b]);
                }
                true
            }
            Drag::Move { atoms, origin, start, moved, .. } => {
                let d = m - *start;
                if *moved || d.len() * self.view.scale >= DRAG_PX {
                    *moved = true;
                    for (&i, &o) in atoms.iter().zip(origin.iter()) {
                        self.mol.atoms[i].pos = o + d;
                    }
                    true
                } else {
                    false
                }
            }
            Drag::Erase { changed, .. } => {
                let erased = self.erase_at(p);
                *changed |= erased;
                let (hover, bracket) = self.targets(p);
                let moved = hover != self.hover || bracket != self.bracket;
                (self.hover, self.bracket) = (hover, bracket);
                erased || moved
            }
            Drag::Bracket { start, end, screen, moved, .. } => {
                *end = m;
                *moved |= (p - *screen).len() >= DRAG_PX;
                if *moved {
                    let (atoms_from, bonds_from) = (self.mol.atoms.len(), self.mol.bonds.len());
                    self.preview = self.wrapped(*start, m).map(|mol| {
                        let sgroups_from = mol.sgroups.len() - 1;
                        Preview { mol, atoms_from, bonds_from, sgroups_from, note: None }
                    });
                    self.bracket = None;
                }
                *moved
            }
            Drag::Draw { hit, start, screen, moved } => {
                if *moved || (p - *screen).len() >= DRAG_PX {
                    *moved = true;
                    let plan = self.plan(*hit, *start, Some(m));
                    self.preview = self.preview_of(plan);
                    true
                } else {
                    false
                }
            }
        };
        self.drag = Some(drag);
        changed
    }

    pub fn pointer_up(&mut self, x: f64, y: f64) -> bool {
        let p = v2(x, y);
        if p.finite() {
            self.pointer = Some(p);
        }
        let Some(drag) = self.drag.take() else { return false };
        match drag {
            Drag::Pan { .. } | Drag::Marquee { .. } => {}
            Drag::Move { base, atoms, moved, click, .. } => {
                if !moved {
                    if let Some(it) = click {
                        self.clear_selection();
                        self.flag(it, true);
                    }
                } else {
                    // Dropping one atom onto another merges them.
                    if let [i] = atoms[..] {
                        let pos = self.mol.atoms[i].pos;
                        let into = (0..self.mol.atoms.len()).find(|&j| j != i && self.mol.atoms[j].pos.dist(pos) < MERGE);
                        if let Some(m) = into.and_then(|j| tools::merge(&self.mol, i, j)) {
                            self.mol = m;
                        }
                    }
                    self.finish(base, true);
                }
            }
            Drag::Erase { base, changed } => {
                if changed {
                    self.finish(base, true);
                }
            }
            Drag::Draw { hit, start, moved, .. } => {
                let cursor = if moved && p.finite() { Some(self.view.model(p)) } else { None };
                self.preview = None;
                match self.plan(hit, start, cursor) {
                    Some((m, _)) => {
                        self.commit(m);
                    }
                    None if self.tool == Tool::Template && self.template.is_none() => {
                        self.message = "Choose a template first".into();
                    }
                    None if self.tool == Tool::Template => {
                        self.message = "This template does not fit here".into();
                    }
                    None => {}
                }
            }
            Drag::Bracket { start, end, moved, group, .. } => {
                self.preview = None;
                let end = if p.finite() { self.view.model(p) } else { end };
                if moved {
                    match self.wrapped(start, end) {
                        Some(next) => {
                            self.commit(next);
                        }
                        None => self.message = "Drag around the atoms of the repeat unit".into(),
                    }
                } else if let Some(k) = group.filter(|&k| k < self.mol.sgroups.len()) {
                    let mut next = self.mol.clone();
                    next.sgroups.remove(k);
                    self.commit(next);
                } else {
                    self.message = "Drag around the atoms of the repeat unit".into();
                }
            }
        }
        self.update_hover();
        true
    }

    pub fn pointer_leave(&mut self) -> bool {
        if self.drag.is_some() {
            return false;
        }
        self.pointer = None;
        self.update_hover()
    }

    pub fn double_click(&mut self, x: f64, y: f64) -> bool {
        if self.tool != Tool::Select {
            return false;
        }
        let atom = match self.hit(v2(x, y)) {
            Some(Item::Atom(i)) => i,
            Some(Item::Bond(b)) => self.mol.bonds[b].a,
            None => return false,
        };
        let frag = self.mol.fragment(atom);
        for (i, s) in self.atoms.iter_mut().enumerate() {
            *s |= frag[i];
        }
        for (b, s) in self.mol.bonds.iter().zip(self.bonds.iter_mut()) {
            *s |= frag[b.a];
        }
        true
    }

    pub fn wheel(&mut self, x: f64, y: f64, dx: f64, dy: f64, zoom: bool) -> bool {
        if ![x, y, dx, dy].iter().all(|v| v.is_finite()) {
            return false;
        }
        if zoom {
            return self.zoom_at(v2(x, y), (-dy.clamp(-200., 200.) * 0.002).exp());
        }
        if dx != 0. || dy != 0. {
            self.fit_on_resize = false;
        }
        self.view.offset = self.view.offset - v2(dx, dy);
        self.update_hover();
        true
    }

    fn hovered_atom(&self) -> Option<usize> {
        match self.hover {
            Some(Item::Atom(i)) => Some(i),
            _ => None,
        }
    }

    pub fn key(&mut self, key: &str, shift: bool, primary: bool, _alt: bool) -> bool {
        if primary {
            return match key.to_ascii_lowercase().as_str() {
                "z" => self.step(!shift),
                "y" => self.step(false),
                "a" => self.select_all(),
                _ => false,
            };
        }
        if matches!(key, "Escape" | "Esc") {
            return self.cancel();
        }
        if self.drag.is_some() {
            return false;
        }
        let charge = |d: i8, e: &mut Editor| {
            let edit = e.hovered_atom().and_then(|i| tools::add_charge(&e.mol, i, d));
            edit.is_some_and(|m| e.commit(m))
        };
        match key {
            // The selection first, else the item under the pointer.
            "Delete" | "Backspace" => match self.hover {
                Some(it) if !self.atoms.iter().chain(&self.bonds).any(|&x| x) => self.delete_item(it),
                _ => self.command("delete"),
            },
            "+" | "=" => charge(1, self),
            "-" | "−" => charge(-1, self),
            "1" | "2" | "3" => {
                let order = key.as_bytes()[0] - b'0';
                if let Some(Item::Bond(b)) = self.hover {
                    return tools::set_order(&self.mol, b, order).is_some_and(|m| self.commit(m));
                }
                let kind = [BondKind::Single, BondKind::Double, BondKind::Triple][order as usize - 1];
                self.tool = Tool::Bond(kind);
                self.update_hover();
                true
            }
            _ => {
                let el = match key.to_ascii_lowercase().as_str() {
                    "c" => 6,
                    "n" => 7,
                    "o" => 8,
                    "s" => 16,
                    "p" => 15,
                    "f" => 9,
                    "i" => 53,
                    "h" => 1,
                    "l" => 17,
                    "b" => 35,
                    _ => return false,
                };
                match self.hovered_atom() {
                    Some(i) => tools::set_element(&self.mol, i, el).is_some_and(|m| self.commit(m)),
                    None => {
                        self.tool = Tool::Atom(el);
                        self.update_hover();
                        true
                    }
                }
            }
        }
    }

    /// Shows why a command did nothing; returns true so the state repaints.
    fn say(&mut self, text: &str) -> bool {
        self.message = text.into();
        true
    }

    pub fn command(&mut self, name: &str) -> bool {
        if !matches!(name, "fit" | "zoom-in" | "zoom-out" | "cancel") {
            self.cancel_drag();
        }
        self.message.clear();
        let empty = self.mol.is_empty();
        match name {
            "undo" => self.step(true),
            "redo" => self.step(false),
            "layout" | "clean" | "aromatic" | "hydrogens" if empty => self.say("Draw a structure first"),
            "layout" | "clean" => {
                let keep = name == "clean";
                let Ok(next) = chem::relayout(&self.mol, keep) else { return self.say("Could not lay out this structure") };
                let changed = self.commit(next);
                if !keep {
                    self.fit();
                }
                changed || !keep
            }
            "aromatic" => {
                let mut next = self.mol.clone();
                if next.bonds.iter().any(|b| b.arom) {
                    next.bonds.iter_mut().for_each(|b| b.arom = false);
                } else {
                    let Ok(flags) = chem::aromatic_bonds(&self.mol) else { return self.say("Could not find aromatic rings") };
                    if !flags.contains(&true) {
                        return self.say("No aromatic rings found");
                    }
                    next.bonds.iter_mut().zip(flags).for_each(|(b, f)| b.arom = f);
                }
                let base = std::mem::replace(&mut self.mol, next);
                self.finish(base, false)
            }
            "cip" => {
                if self.cip.take().is_some() {
                    return true;
                }
                if empty {
                    return self.say("Draw a structure first");
                }
                let Ok(labels) = chem::cip_labels(&self.mol) else { return self.say("Could not assign CIP labels") };
                if labels.0.iter().chain(&labels.1).all(Option::is_none) {
                    self.message = "No stereocenters found".into();
                }
                self.cip = Some(labels);
                true
            }
            "hydrogens" => {
                let next = if explicit_h(&self.mol) {
                    chem::remove_hydrogens(&self.mol)
                } else {
                    match chem::add_hydrogens(&self.mol) {
                        Ok(m) if m.atoms.len() > self.mol.atoms.len() => m,
                        Ok(_) => return self.say("No implicit hydrogens to show"),
                        Err(_) => return self.say("Could not add hydrogens"),
                    }
                };
                self.commit(next)
            }
            "select-all" => self.select_all(),
            "delete" => {
                let (a, b) = (self.atoms.clone(), self.bonds.clone());
                self.delete(&a, &b)
            }
            "clear" => self.commit(Mol::default()),
            "fit" => self.fit(),
            "zoom-in" => self.zoom_at(self.center(), self.zoom_step(true)),
            "zoom-out" => self.zoom_at(self.center(), self.zoom_step(false)),
            "cancel" => self.cancel(),
            _ => false,
        }
    }

    // ------------------------------------------------------------- output

    pub fn svg(&self) -> String {
        let marquee = match &self.drag {
            Some(Drag::Marquee { start, end, .. } | Drag::Bracket { start, end, moved: true, .. }) => Some((*start, *end)),
            _ => None,
        };
        let (hover, bracket) = match self.drag {
            Some(Drag::Move { .. } | Drag::Pan { .. } | Drag::Marquee { .. } | Drag::Bracket { moved: true, .. }) => (None, None),
            _ => (self.hover, self.bracket),
        };
        let mut marks = self.marks.take();
        if let Some(cip) = &self.cip
            && marks.as_ref().is_none_or(|(on, _)| *on != self.mol)
        {
            marks = Some((self.mol.clone(), render::cip_marks(&self.mol, cip)));
        }
        let marked_atoms: Vec<bool> = self.atoms.iter().enumerate().map(|(i, selected)| *selected || self.highlighted_atoms.get(i).copied().unwrap_or(false)).collect();
        let overlay = Overlay {
            hover,
            atoms: &marked_atoms,
            bonds: &self.bonds,
            preview: self.preview.as_ref(),
            marquee,
            cip: self.cip.as_ref().and(marks.as_ref()).map(|(_, m)| &m[..]),
            bracket,
        };
        let svg = render::svg(&self.mol, &self.view, &overlay);
        self.marks.set(marks);
        svg
    }

    fn cursor(&self) -> &'static str {
        match &self.drag {
            Some(Drag::Pan { .. }) => return "grabbing",
            Some(Drag::Move { moved: true, .. }) => return "move",
            _ => {}
        }
        match (self.tool, self.hover) {
            (Tool::Hand, _) => "grab",
            _ if self.bracket.is_some() => "pointer",
            (Tool::Select, Some(it)) if self.selected(it) => "move",
            (_, Some(_)) => "pointer",
            (Tool::Select | Tool::Erase, None) => "default",
            _ => "crosshair",
        }
    }

    /// Zoom in percent of the natural scale.
    pub fn zoom(&self) -> i64 {
        (self.view.scale / NATURAL_SCALE * 100.).round() as i64
    }

    pub fn state(&self) -> String {
        let selection = self.atoms.iter().chain(&self.bonds).filter(|&&x| x).count();
        let message: String = self.message.chars().filter(|c| !c.is_control()).map(|c| if c == '"' { '\'' } else { c }).collect();
        format!(
            "{{\"tool\":\"{}\",\"canUndo\":{},\"canRedo\":{},\"aromatic\":{},\"cip\":{},\"hydrogens\":{},\"empty\":{},\"selection\":{},\"cursor\":\"{}\",\"revision\":{},\"zoom\":{},\"message\":\"{}\",\"selectedAtoms\":{:?},\"selectedBonds\":{:?}}}",
            self.tool.id(),
            !self.undo.is_empty(),
            !self.redo.is_empty(),
            self.mol.bonds.iter().any(|b| b.arom),
            self.cip.is_some(),
            explicit_h(&self.mol),
            self.mol.is_empty(),
            selection,
            self.cursor(),
            self.revision,
            self.zoom(),
            message.replace('\\', "/"),
            self.atoms.iter().enumerate().filter_map(|(i, selected)| selected.then_some(i)).collect::<Vec<_>>(),
            self.bonds.iter().enumerate().filter_map(|(i, selected)| selected.then_some(i)).collect::<Vec<_>>(),
        )
    }

    pub fn highlight_atoms(&mut self, indexes: &[u32]) -> Result<(), String> {
        if indexes.iter().any(|&index| index as usize >= self.mol.atoms.len()) {
            return Err("Atom index is outside the current structure".to_string());
        }
        self.highlighted_atoms = vec![false; self.mol.atoms.len()];
        for &index in indexes { self.highlighted_atoms[index as usize] = true; }
        Ok(())
    }

    pub fn set_selection(&mut self, atoms: &[u32], bonds: &[u32]) -> Result<(), String> {
        if atoms.iter().any(|&i| i as usize >= self.mol.atoms.len())
            || bonds.iter().any(|&i| i as usize >= self.mol.bonds.len()) {
            return Err("Selection index is outside the current structure".to_string());
        }
        self.cancel_drag();
        self.atoms = vec![false; self.mol.atoms.len()];
        self.bonds = vec![false; self.mol.bonds.len()];
        for &i in atoms { self.atoms[i as usize] = true; }
        for &i in bonds { self.bonds[i as usize] = true; }
        Ok(())
    }

    /// Sets the template tool's template (1-based attachment atom and bond,
    /// 0 for none).
    pub fn set_template(&mut self, molfile: &str, atom: u32, bond: u32) -> Result<(), String> {
        let t = Template::parse(molfile, atom, bond)?;
        self.cancel_drag();
        self.template = Some(t);
        self.update_hover();
        Ok(())
    }

    pub fn load(&mut self, text: &str) -> Result<(), String> {
        let next = if text.trim().is_empty() { Mol::default() } else { chem::parse(text)? };
        self.cancel_drag();
        let base = std::mem::replace(&mut self.mol, next);
        if !base.is_empty() {
            self.push_undo(base);
        }
        self.redo.clear();
        self.atoms.clear();
        self.bonds.clear();
        self.changed();
        self.fit();
        Ok(())
    }

    pub fn insert(&mut self, text: &str) -> Result<(), String> {
        let frag = chem::parse(text)?;
        let (flo, fhi) = render::extent(&frag).ok_or_else(|| chem::UNREADABLE.to_string())?;
        let shift = match render::extent(&self.mol) {
            Some((lo, hi)) => v2(hi.x + 1.5 - flo.x, (lo.y + hi.y - flo.y - fhi.y) * 0.5),
            None => self.view.model(self.center()) - (flo + fhi) * 0.5,
        };
        self.cancel_drag();
        let mut next = self.mol.clone();
        let (atoms_from, bonds_from) = (next.atoms.len(), next.bonds.len());
        next.append(&frag, shift);
        self.commit(next);
        self.clear_selection();
        let new_atoms = self.atoms.iter_mut().skip(atoms_from);
        new_atoms.chain(self.bonds.iter_mut().skip(bonds_from)).for_each(|s| *s = true);
        let (lo, hi) = (self.view.screen(flo + shift), self.view.screen(fhi + shift));
        if lo.x < 0. || lo.y < 0. || hi.x > self.view.width || hi.y > self.view.height {
            self.fit();
        }
        Ok(())
    }

    pub fn smiles(&self) -> String {
        chem::smiles(&self.mol)
    }

    pub fn molfile(&self) -> String {
        chem::write_v2000(&self.mol)
    }

    pub fn selection_molfile(&self) -> String {
        let mut keep = self.atoms.clone();
        keep.resize(self.mol.atoms.len(), false);
        for (b, _) in self.mol.bonds.iter().zip(&self.bonds).filter(|x| *x.1) {
            (keep[b.a], keep[b.b]) = (true, true);
        }
        if !keep.iter().any(|&k| k) {
            return String::new();
        }
        let mut selected = self.mol.clone();
        selected.bonds = self.mol.bonds.iter().zip(&self.bonds).filter(|(_, chosen)| **chosen).map(|(bond, _)| bond.clone()).collect();
        chem::write_v2000(&selected.subset(&keep))
    }

    pub fn molfile_3d(&self) -> Result<String, String> {
        chem::molfile_3d(&self.mol)
    }

    #[cfg(test)]
    pub fn mol(&self) -> &Mol {
        &self.mol
    }

    #[cfg(test)]
    pub fn view(&self) -> View {
        self.view
    }
}
