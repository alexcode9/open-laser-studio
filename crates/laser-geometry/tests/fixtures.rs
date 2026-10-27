//! Shared fixtures with the TypeScript adapters (`tests/fixtures/coordinates.json`).

use laser_core::CylinderSpec;
use laser_geometry::CylinderTransform;
use serde_json::Value;

fn fixtures() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/coordinates.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture file")).expect("valid json")
}

fn f(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap_or_else(|| panic!("missing {k}"))
}

#[test]
fn surface_machine_cases() {
    let fx = fixtures();
    let tol = f(&fx, "tolerance");
    for case in fx["cases"].as_array().expect("cases") {
        let spec: CylinderSpec = serde_json::from_value(case["spec"].clone()).expect("spec");
        let cyl = CylinderTransform::new(spec);
        let (u, s) = (f(&case["surface"], "u"), f(&case["surface"], "s"));
        let (a, mu) = cyl.surface_to_machine(u, s);
        let name = case["name"].as_str().unwrap_or_default();
        assert!((a - f(&case["machine"], "aDeg")).abs() < tol, "{name}: A {a}");
        assert!((mu - f(&case["machine"], "uMm")).abs() < tol, "{name}: U {mu}");
        assert!((cyl.a_deg_to_s(a) - s).abs() < tol, "{name}: inverse s");
        assert!((cyl.machine_u_to_u(mu) - u).abs() < tol, "{name}: inverse u");
    }
}

#[test]
fn galvo_and_wrap_cases() {
    let fx = fixtures();
    let tol = f(&fx, "tolerance");
    for g in fx["galvo"].as_array().expect("galvo") {
        let cyl = CylinderTransform::new(CylinderSpec { diameter_mm: f(g, "diameterMm"), ..Default::default() });
        assert!((cyl.arc_to_galvo_offset(f(g, "dsMm")) - f(g, "offsetMm")).abs() < tol);
        assert!((cyl.focus_error_mm(f(g, "dsMm")) - f(g, "focusErrorMm")).abs() < tol);
    }
    for w in fx["wrap"].as_array().expect("wrap") {
        let cyl = CylinderTransform::new(CylinderSpec { diameter_mm: f(w, "diameterMm"), ..Default::default() });
        let (rev, sw) = cyl.wrap_s(f(w, "sMm"));
        assert_eq!(rev, w["rev"].as_i64().expect("rev"));
        assert!((sw - f(w, "sWrapped")).abs() < tol);
    }
}
