use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const PACKAGE: &str = "avogadro-harmonic-energy";
const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/avogadro/energy-plugin")
        .join(name)
}

fn python() -> PathBuf {
    std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|dir| dir.join("python3"))
        .find(|path| path.is_file())
        .expect("python3 on PATH")
}

/// An installed, set-up package whose console script runs the fixture.
fn installed_fixture(prepared: bool) -> PathBuf {
    let root = std::env::temp_dir().join(format!("burette-energy-models-{}", uuid::Uuid::new_v4()));
    let dir = root.join(PACKAGE).join(COMMIT);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(fixture("pyproject.toml"), dir.join("pyproject.toml")).unwrap();
    std::fs::write(
        root.join(PACKAGE).join("installed.json"),
        serde_json::json!({ "name": PACKAGE, "version": "0.1.0", "commit": COMMIT, "sha256": "0".repeat(64),
            "archiveBytes": 1, "files": 2, "expandedBytes": 1 })
        .to_string(),
    )
    .unwrap();
    if prepared {
        let bin = dir.join(".pixi/envs/default/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let script = bin.join(PACKAGE);
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
                python().display(),
                fixture("harmonic_energy.py").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    root
}

fn request(model: &str, charge: i32) -> OpenRequest {
    let xyz = "2\nfixture\nAr 1 2 3\nAr 0 0 1\n";
    let bootstrap = if model.ends_with("binary") {
        serde_json::json!({ "charge": charge, "spin": 1, "selectedAtoms": [], "options": {},
            "cjson": { "atoms": { "elements": { "number": [18, 18] }, "coords": { "3d": [1, 2, 3, 0, 0, 1] } } } })
    } else {
        serde_json::json!({ "charge": charge, "spin": 1, "selectedAtoms": [], "options": {}, "xyz": xyz })
    };
    OpenRequest {
        model: model.into(),
        elements: vec!["Ar".into(), "Ar".into()],
        charge,
        multiplicity: 1,
        bootstrap: Some(bootstrap.to_string()),
    }
}

fn no_xtb() -> Result<PathBuf, String> {
    Err("xTB is not installed".into())
}

#[test]
fn installed_packages_list_their_declared_models_and_setup_state() {
    let root = installed_fixture(false);
    let models = plugin_models(&root);
    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        [
            "avogadro:avogadro-harmonic-energy/harmonic-text",
            "avogadro:avogadro-harmonic-energy/harmonic-binary"
        ]
    );
    assert_eq!(models[1].input_format.as_deref(), Some("cjson"));
    assert!(models[0].gradients && models[0].ions && !models[0].radicals);
    assert_eq!(models[0].elements.len(), 118);
    assert!(models[0].unavailable.as_deref().unwrap().contains("Set up"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn both_protocols_return_kcal_energies_and_gradients_from_a_persistent_process() {
    let root = installed_fixture(true);
    assert!(plugin_models(&root).iter().all(|m| m.unavailable.is_none()));
    for model in ["harmonic-text", "harmonic-binary"] {
        let id = format!("{AVOGADRO_PREFIX}{PACKAGE}/{model}");
        let Backend::Script(mut session) = open_backend(request(&id, 2), no_xtb, &root).unwrap()
        else {
            panic!("a script session");
        };
        let cancel = AtomicBool::new(false);
        // |r|² = 14 + 1, plus the bootstrap charge: 17 kJ/mol.
        let first = session
            .evaluate(&[1.0, 2.0, 3.0, 0.0, 0.0, 1.0], &cancel)
            .unwrap();
        assert!((first.energy - 17.0 / KJ_PER_KCAL).abs() < 1e-12, "{model}");
        let expected = [2.0, 4.0, 6.0, 0.0, 0.0, 2.0].map(|g| g / KJ_PER_KCAL);
        for (a, b) in first.gradient.unwrap().iter().zip(expected) {
            assert!((a - b).abs() < 1e-12);
        }
        // The same process answers later requests, including tiny coordinates.
        let second = session
            .evaluate(&[1e-17, 0.0, 0.0, 0.5, 0.0, 0.0], &cancel)
            .unwrap();
        assert!((second.energy - 2.25 / KJ_PER_KCAL).abs() < 1e-12);
        let refused = session
            .evaluate(&[5000.0, 0.0, 0.0, 0.0, 0.0, 0.0], &cancel)
            .unwrap_err();
        if model == "harmonic-binary" {
            assert_eq!(
                refused,
                "The energy model reported an error: coordinates out of range"
            );
            assert!(session.evaluate(&[0.0; 6], &cancel).is_ok());
            assert_eq!(
                session
                    .evaluate(&[0.0; 6], &AtomicBool::new(true))
                    .unwrap_err(),
                CANCELLED
            );
        } else {
            assert!(
                refused.starts_with("The energy model process exited"),
                "{refused}"
            );
            assert!(refused.ends_with("coordinates out of range"), "{refused}");
            assert!(session.evaluate(&[0.0; 6], &cancel).is_err());
        }
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn sessions_refuse_undeclared_models_and_malformed_requests() {
    let root = installed_fixture(true);
    let model = format!("{AVOGADRO_PREFIX}{PACKAGE}/harmonic-text");
    let refuse = |request: OpenRequest| match open_backend(request, no_xtb, &root) {
        Err(error) => error,
        Ok(_) => panic!("opened"),
    };
    assert!(
        refuse(request(&format!("{AVOGADRO_PREFIX}{PACKAGE}/--debug"), 0))
            .contains("does not declare")
    );
    assert!(
        refuse(request(&format!("{AVOGADRO_PREFIX}other/harmonic-text"), 0))
            .contains("not installed")
    );
    assert_eq!(refuse(request("xtb:gfn2", 0)), "xTB is not installed");
    assert_eq!(refuse(request("xtb:pm7", 0)), "Unknown xTB method");
    let mut multiline = request(&model, 0);
    multiline.bootstrap = Some("{}\n{}".into());
    assert_eq!(refuse(multiline), "Invalid energy model input");
    let mut odd = request(&model, 0);
    odd.elements = vec!["ar".into(), "Ar".into()];
    assert_eq!(refuse(odd), "Invalid element symbol");
    let mut empty = request(&model, 0);
    empty.elements = Vec::new();
    assert!(refuse(empty).contains("1–256 atoms"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn sessions_belong_to_their_window_and_close_with_it() {
    let root = installed_fixture(true);
    let model = format!("{AVOGADRO_PREFIX}{PACKAGE}/harmonic-binary");
    let window = format!("workspace-{}", uuid::Uuid::new_v4());
    let open = || open_backend(request(&model, 0), no_xtb, &root).unwrap();
    let first = register(&window, 2, open()).unwrap();
    let second = register(&window, 2, open()).unwrap();
    assert!(evaluate(&window, &first, &[0.0; 6]).is_ok());
    assert_eq!(
        evaluate("main", &first, &[0.0; 6]).unwrap_err(),
        "This energy model session is closed"
    );
    assert!(evaluate(&window, &first, &[0.0; 3])
        .unwrap_err()
        .contains("match the structure"));
    assert!(evaluate(&window, &first, &[f64::NAN; 6]).is_err());
    close_where(|id, session| id != first || session.owner != window);
    assert!(evaluate(&window, &first, &[0.0; 6]).is_err());
    assert!(evaluate(&window, &second, &[0.0; 6]).is_ok());
    window_destroyed(&window);
    assert!(evaluate(&window, &second, &[0.0; 6]).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

/// The real avogadro-xtb-energy package (ghutchis/avogadro-xtb-energy@287e8093)
/// after `pixi install`: `BURETTE_AVOGADRO_XTB_ENERGY=<package folder> cargo test
/// --lib real_avogadro_xtb_energy -- --ignored`. Its GFN2 and GFN-FF models speak
/// binary-v1 and must agree with the xtb program on the recorded water geometry.
#[test]
#[ignore]
fn real_avogadro_xtb_energy_plugin_matches_the_xtb_program() {
    const PACKAGE: &str = "avogadro-xtb-energy";
    const COMMIT: &str = "287e8093f65bca5b9d27fbf517a8719ae319d108";
    let source =
        PathBuf::from(std::env::var_os("BURETTE_AVOGADRO_XTB_ENERGY").expect("package folder"));
    let root = std::env::temp_dir().join(format!("burette-energy-real-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join(PACKAGE)).unwrap();
    std::os::unix::fs::symlink(&source, root.join(PACKAGE).join(COMMIT)).unwrap();
    std::fs::write(
        root.join(PACKAGE).join("installed.json"),
        serde_json::json!({ "name": PACKAGE, "version": "0.2.0", "commit": COMMIT, "sha256": "0".repeat(64),
            "archiveBytes": 1, "files": 1, "expandedBytes": 1 })
        .to_string(),
    )
    .unwrap();
    let ids: Vec<_> = plugin_models(&root)
        .into_iter()
        .map(|m| (m.id, m.unavailable))
        .collect();
    assert_eq!(
        ids,
        ["GFN1", "GFN2", "GFN-FF"].map(|id| (format!("{AVOGADRO_PREFIX}{PACKAGE}/{id}"), None))
    );
    let water = [
        0.0, 0.0, 0.1173, 0.0, 0.7572, -0.4692, 0.0, -0.7572, -0.4692,
    ];
    let bootstrap = serde_json::json!({ "charge": 0, "spin": 1, "selectedAtoms": [], "options": {},
        "cjson": { "chemicalJson": 1, "atoms": { "elements": { "number": [8, 1, 1] }, "coords": { "3d": water } },
            "bonds": { "connections": { "index": [0, 1, 0, 2] }, "order": [1, 1] } } });
    let open = |model: &str| {
        let request = OpenRequest {
            model: format!("{AVOGADRO_PREFIX}{PACKAGE}/{model}"),
            elements: vec!["O".into(), "H".into(), "H".into()],
            charge: 0,
            multiplicity: 1,
            bootstrap: Some(bootstrap.to_string()),
        };
        match open_backend(request, no_xtb, &root).unwrap() {
            Backend::Script(session) => session,
            Backend::Xtb(_) => panic!("a script session"),
        }
    };
    let cancel = AtomicBool::new(false);
    let mut gfn2 = open("GFN2");
    let first = gfn2.evaluate(&water, &cancel).unwrap();
    // xtb 6.7.1 `--gfn 2 --grad`: −5.070370761845 Eh, dE/dz(O) = 0.002940222116 Eh/bohr.
    assert!(
        (first.energy - -3181.70569).abs() < 1e-3,
        "{}",
        first.energy
    );
    // At this commit the plugin converts Eh/bohr with `2625.5 / (1 / 0.529…)`, a
    // factor of bohr² too small (Eh·bohr⁻¹ → kJ·mol⁻¹·Å⁻¹ multiplies by 1/0.529…).
    // Burette passes the reply on unchanged; directions and minima are unaffected.
    let gradient = first.gradient.unwrap();
    let bohr_squared = 0.529_177_210_67_f64.powi(2);
    assert!(
        (gradient[2] - 3.486_577 * bohr_squared).abs() < 1e-4,
        "{gradient:?}"
    );
    let mut moved = water;
    moved[4] += 0.05;
    assert!(gfn2.evaluate(&moved, &cancel).unwrap().energy > first.energy);
    let mut ff = open("GFN-FF");
    assert!(ff.evaluate(&water, &cancel).unwrap().energy.is_finite());
    drop((gfn2, ff));
    std::fs::remove_dir_all(root).unwrap();
}
