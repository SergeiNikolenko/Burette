//! Term-local forward derivatives for MMFF optimization. The finite-difference
//! evaluator remains independent and is used for reference validation.
use crate::{evaluate_mmff_energy, MmffError, MmffEvaluation, MmffParameters};
use std::ops::{Add, Div, Mul, Neg, Sub};

#[derive(Clone, Copy)]
struct Dual {
    value: f64,
    gradient: [f64; 12],
}
impl From<f64> for Dual {
    fn from(value: f64) -> Self {
        Self {
            value,
            gradient: [0.0; 12],
        }
    }
}
impl Add for Dual {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self {
            value: self.value + rhs.value,
            gradient: std::array::from_fn(|i| self.gradient[i] + rhs.gradient[i]),
        }
    }
}
impl Neg for Dual {
    type Output = Self;
    fn neg(self) -> Self {
        Self {
            value: -self.value,
            gradient: self.gradient.map(|v| -v),
        }
    }
}
impl Sub for Dual {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        self + -rhs
    }
}
impl Mul for Dual {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        Self {
            value: self.value * rhs.value,
            gradient: std::array::from_fn(|i| {
                self.gradient[i] * rhs.value + self.value * rhs.gradient[i]
            }),
        }
    }
}
impl Div for Dual {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        let inv = 1.0 / rhs.value;
        Self {
            value: self.value * inv,
            gradient: std::array::from_fn(|i| {
                (self.gradient[i] - self.value * inv * rhs.gradient[i]) * inv
            }),
        }
    }
}
impl Dual {
    fn map(self, value: f64, derivative: f64) -> Self {
        Self {
            value,
            gradient: self.gradient.map(|v| v * derivative),
        }
    }
    fn sqrt(self) -> Self {
        let root = self.value.max(1e-20).sqrt();
        self.map(root, 0.5 / root)
    }
    fn acos(self) -> Self {
        let v = self.value.clamp(-1.0, 1.0);
        self.map(v.acos(), -1.0 / (1.0 - v * v).max(1e-20).sqrt())
    }
    fn asin(self) -> Self {
        let v = self.value.clamp(-1.0, 1.0);
        self.map(v.asin(), 1.0 / (1.0 - v * v).max(1e-20).sqrt())
    }
    fn cos(self) -> Self {
        self.map(self.value.cos(), -self.value.sin())
    }
    fn pow7(self) -> Self {
        self.map(self.value.powi(7), 7.0 * self.value.powi(6))
    }
}
fn c(value: impl Into<f64>) -> Dual {
    Dual::from(value.into())
}
type Vector = [Dual; 3];
fn sub(a: Vector, b: Vector) -> Vector {
    std::array::from_fn(|i| a[i] - b[i])
}
fn dot(a: Vector, b: Vector) -> Dual {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: Vector, b: Vector) -> Vector {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn length(a: Vector) -> Dual {
    dot(a, a).sqrt()
}
fn normalize(a: Vector) -> Vector {
    let norm = length(a);
    a.map(|v| v / norm)
}
fn distance(a: Vector, b: Vector) -> Dual {
    length(sub(a, b))
}
fn angle(p: &[Vector]) -> Dual {
    let a = sub(p[0], p[1]);
    let b = sub(p[2], p[1]);
    (dot(a, b) / (length(a) * length(b))).acos()
}
fn dihedral(p: &[Vector]) -> Dual {
    let a = cross(sub(p[1], p[0]), sub(p[2], p[1]));
    let b = cross(sub(p[2], p[1]), sub(p[3], p[2]));
    dot(a, b) / (length(a) * length(b))
}
fn out_of_plane(p: &[Vector]) -> Dual {
    let a = normalize(sub(p[0], p[1]));
    let b = normalize(sub(p[2], p[1]));
    let d = normalize(sub(p[3], p[1]));
    dot(normalize(cross(a.map(|v| -v), b)), d).asin()
}

fn accumulate<const N: usize>(
    positions: &[[f32; 4]],
    gradients: &mut [[f32; 4]],
    atoms: [u32; N],
    energy: impl FnOnce(&[Vector; N]) -> Dual,
) {
    let points = std::array::from_fn(|slot| {
        std::array::from_fn(|axis| {
            let mut value = c(positions[atoms[slot] as usize][axis]);
            value.gradient[slot * 3 + axis] = 1.0;
            value
        })
    });
    let result = energy(&points);
    for (slot, atom) in atoms.iter().enumerate() {
        for axis in 0..3 {
            gradients[*atom as usize][axis] += result.gradient[slot * 3 + axis] as f32;
        }
    }
}

pub(crate) fn evaluate_mmff_analytic(
    parameters: &MmffParameters,
    positions: &[[f32; 4]],
) -> Result<MmffEvaluation, MmffError> {
    // Also validates all atom indices and domains before term-local access.
    let energy = evaluate_mmff_energy(parameters, positions)?;
    let mut gradients = vec![[0.0; 4]; positions.len()];
    let radians = std::f64::consts::PI / 180.0;
    for t in &parameters.bonds {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let d = distance(p[0], p[1]) - c(t.equilibrium_distance);
            c(0.5 * 143.9325 * f64::from(t.force_constant))
                * d
                * d
                * (c(1.0) - c(2.0) * d + c(7.0 / 3.0) * d * d)
        });
    }
    for t in &parameters.angles {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let a = angle(p);
            if t.linear {
                return c(143.9325 * f64::from(t.force_constant)) * (c(1.0) + a.cos());
            }
            let d = a / c(radians) - c(t.equilibrium_degrees);
            c(0.5 * 143.9325 * radians * radians * f64::from(t.force_constant))
                * d
                * d
                * (c(1.0) - c(0.4 * radians) * d)
        });
    }
    for t in &parameters.stretch_bends {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let a = angle(p) / c(radians) - c(t.equilibrium_degrees);
            c(2.51210)
                * a
                * (c(t.force_ij) * (distance(p[0], p[1]) - c(t.equilibrium_ij))
                    + c(t.force_kj) * (distance(p[2], p[1]) - c(t.equilibrium_kj)))
        });
    }
    for t in &parameters.out_of_planes {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let a = out_of_plane(p);
            c(0.5 * 143.9325 * f64::from(t.force_constant)) * a * a
        });
    }
    for t in &parameters.torsions {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let a = dihedral(p);
            let a2 = c(2.0) * a * a - c(1.0);
            let a3 = a * (c(4.0) * a * a - c(3.0));
            c(0.5) * (c(t.v1) * (c(1.0) + a) + c(t.v2) * (c(1.0) - a2) + c(t.v3) * (c(1.0) + a3))
        });
    }
    for t in &parameters.van_der_waals {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            let rho = distance(p[0], p[1]) / c(t.r_star);
            let buffered = c(1.07) / (rho + c(0.07));
            c(t.epsilon) * buffered.pow7() * (c(1.12) / (rho.pow7() + c(0.12)) - c(2.0))
        });
    }
    for t in &parameters.electrostatics {
        accumulate(positions, &mut gradients, t.atoms, |p| {
            c(if t.is_one_four { 0.75 } else { 1.0 }) * c(332.0716) * c(t.charge_product)
                / (distance(p[0], p[1]) + c(0.05))
        });
    }
    // Never let a non-finite derivative enter the optimizer.
    if gradients.iter().flatten().any(|value| !value.is_finite()) {
        return Err(MmffError::new("MMFF analytic gradient is not finite"));
    }
    Ok(MmffEvaluation { energy, gradients })
}
