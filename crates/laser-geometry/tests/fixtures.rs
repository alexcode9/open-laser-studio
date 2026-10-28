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

fn vec3(v: &Value) -> [f64; 3] {
    let a = v.as_array().expect("vec3");
    [a[0].as_f64().expect("x"), a[1].as_f64().expect("y"), a[2].as_f64().expect("z")]
}

/// `tests/fixtures/cad_alignment.json`: CAD axis -> rotary workpiece frame.
#[test]
fn cad_alignment_cases() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/cad_alignment.json");
    let fx: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("fixture file")).expect("valid json");
    let tol = f(&fx, "tolerance");
    for case in fx["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().unwrap_or_default();
        let params: laser_geometry::AlignParams = serde_json::from_value(case["params"].clone()).expect("params");
        let r = laser_geometry::align_axis_to_rotary(&params).expect("aligns");
        assert!((r.length_mm - f(case, "lengthMm")).abs() < tol, "{name}: length");
        let seam = vec3(&case["seamDirection"]);
        assert!((0..3).all(|i| (r.seam_direction[i] - seam[i]).abs() < tol), "{name}: seam {:?}", r.seam_direction);
        for p in case["points"].as_array().expect("points") {
            let (model, wp) = (vec3(&p["model"]), vec3(&p["workpiece"]));
            let got = r.model_to_workpiece.transform_point(model);
            assert!((0..3).all(|i| (got[i] - wp[i]).abs() < tol), "{name}: {model:?} -> {got:?}, expected {wp:?}");
            let back = r.workpiece_to_model.transform_point(wp);
            assert!((0..3).all(|i| (back[i] - model[i]).abs() < tol), "{name}: inverse {back:?}");
        }
        // Serialised layout is the column-major array the renderer hands to three.js.
        let json = serde_json::to_value(&r).expect("serialise");
        assert_eq!(json["modelToWorkpiece"].as_array().map(Vec::len), Some(16));
    }
}
