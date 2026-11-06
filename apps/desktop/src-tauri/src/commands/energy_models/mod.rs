//! External energy models for geometry optimization on the desktop: xTB
//! (GFN2-xTB, GFN1-xTB, GFN-FF) and the energy models installed Avogadro
//! packages declare. Each evaluation returns the energy in kcal/mol and its
//! gradient in kcal/(mol·Å).

mod manifest;
mod script;
mod xtb;

use serde::Serialize;

pub(crate) const CANCELLED: &str = "Cancelled";
pub(crate) const KJ_PER_KCAL: f64 = 4.184;

#[derive(Debug, PartialEq, Serialize)]
pub(crate) struct Evaluation {
    /// Non-finite values reach the webview as `null`; the optimizer rejects them.
    pub(crate) energy: f64,
    pub(crate) gradient: Option<Vec<f64>>,
}
