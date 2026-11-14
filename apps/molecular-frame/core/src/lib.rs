//! Rust/WebAssembly core of the LigandPro 2D structure editor: drawing model,
//! ACS-style SVG rendering, editing tools and a cosmolkit chemistry bridge.
mod chem;
mod editor;
mod geometry;
mod layout;
mod model;
mod render;
mod template;
mod tools;
mod valence;

#[cfg(test)]
mod tests;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Editor {
    core: editor::Editor,
}

impl Default for Editor {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Editor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Editor {
        Editor { core: editor::Editor::new() }
    }

    pub fn resize(&mut self, width: f64, height: f64) {
        self.core.resize(width, height)
    }

    pub fn set_tool(&mut self, tool: &str) {
        self.core.set_tool(tool)
    }

    pub fn pointer_down(&mut self, x: f64, y: f64, button: u8, shift: bool, alt: bool) -> bool {
        self.core.pointer_down(x, y, button, shift, alt)
    }

    pub fn pointer_move(&mut self, x: f64, y: f64, buttons: u8, shift: bool, alt: bool) -> bool {
        self.core.pointer_move(x, y, buttons, shift, alt)
    }

    pub fn pointer_up(&mut self, x: f64, y: f64) -> bool {
        self.core.pointer_up(x, y)
    }

    pub fn pointer_leave(&mut self) -> bool {
        self.core.pointer_leave()
    }

    pub fn double_click(&mut self, x: f64, y: f64) -> bool {
        self.core.double_click(x, y)
    }

    pub fn wheel(&mut self, x: f64, y: f64, dx: f64, dy: f64, zoom: bool) -> bool {
        self.core.wheel(x, y, dx, dy, zoom)
    }

    pub fn zoom_by(&mut self, factor: f64) -> bool {
        self.core.zoom_by(factor)
    }

    pub fn key(&mut self, key: &str, shift: bool, primary: bool, alt: bool) -> bool {
        self.core.key(key, shift, primary, alt)
    }

    pub fn command(&mut self, name: &str) -> bool {
        self.core.command(name)
    }

    pub fn svg(&self) -> String {
        self.core.svg()
    }

    pub fn state(&self) -> String {
        self.core.state()
    }

    pub fn load(&mut self, text: &str) -> Result<(), JsError> {
        self.core.load(text).map_err(|e| JsError::new(&e))
    }

    pub fn insert(&mut self, text: &str) -> Result<(), JsError> {
        self.core.insert(text).map_err(|e| JsError::new(&e))
    }

    pub fn highlight_atoms(&mut self, indexes: &[u32]) -> Result<(), JsError> {
        self.core.highlight_atoms(indexes).map_err(|e| JsError::new(&e))
    }

    pub fn set_selection(&mut self, atoms: &[u32], bonds: &[u32]) -> Result<(), JsError> {
        self.core.set_selection(atoms, bonds).map_err(|e| JsError::new(&e))
    }

    pub fn smiles(&self) -> String {
        self.core.smiles()
    }

    pub fn molfile(&self) -> String {
        self.core.molfile()
    }

    pub fn selection_molfile(&self) -> String {
        self.core.selection_molfile()
    }

    pub fn molfile_3d(&self) -> Result<String, JsError> {
        self.core.molfile_3d().map_err(|e| JsError::new(&e))
    }

    /// Sets the template for tool `template`. `atom` and `bond` are the
    /// 1-based attachment atom and bond, 0 for none.
    pub fn set_template(&mut self, molfile: &str, atom: u32, bond: u32) -> Result<(), JsError> {
        self.core.set_template(molfile, atom, bond).map_err(|e| JsError::new(&e))
    }
}

/// SVG of a molfile fitted into `width` × `height` (no hover, selection or
/// preview), with the editor's classes.
#[wasm_bindgen]
pub fn thumbnail(molfile: &str, width: f64, height: f64) -> Result<String, JsError> {
    let mol = chem::read_template(molfile).map_err(|e| JsError::new(&e))?;
    Ok(render::thumbnail(&mol, width, height))
}
