//! Sample project opened on first launch: a cylindrical design that wraps once around a
//! 30 mm tube, demonstrating multi-section indexed engraving.

use laser_geometry::PathCmd;

use crate::*;

fn obj(id: &str, name: &str, layer: &str, x: f64, y: f64, shape: Shape) -> DesignObject {
    DesignObject {
        id: id.into(),
        name: name.into(),
        layer_id: layer.into(),
        visible: true,
        locked: false,
        group_id: None,
        transform: Transform2 { x, y, ..Default::default() },
        shape,
    }
}

pub fn sample_project() -> Project {
    let outline = Layer {
        id: "layer-outline".into(),
        name: "Outline".into(),
        color: "#38bdf8".into(),
        settings: LaserSettings { speed_mm_s: 200.0, power_pct: 30.0, ..Default::default() },
        ..Default::default()
    };
    let fill = Layer {
        id: "layer-fill".into(),
        name: "Fill".into(),
        color: "#f97316".into(),
        settings: LaserSettings {
            mode: LayerMode::Fill,
            speed_mm_s: 300.0,
            power_pct: 25.0,
            hatch_spacing_mm: 0.5,
            hatch_angle_deg: 45.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let workpiece = laser_core::CylinderSpec { diameter_mm: 30.0, length_mm: 200.0, ..Default::default() };
    let c = workpiece.circumference_mm();

    // A wave that wraps the full circumference, so the seam is visible in 3D.
    let mut wave = vec![PathCmd::M { x: 0.0, y: c * 0.5 }];
    let steps = 80;
    for i in 1..=steps {
        let u = 180.0 * f64::from(i) / f64::from(steps);
        let s = c * 0.5 + 12.0 * (u / 180.0 * std::f64::consts::TAU * 2.0).sin();
        wave.push(PathCmd::L { x: u, y: s });
    }

    let objects = vec![
        obj("obj-frame", "Frame", "layer-outline", 5.0, 5.0, Shape::Rect { width: 170.0, height: c - 10.0 }),
        obj("obj-wave", "Wave", "layer-outline", 5.0, 0.0, Shape::Path { commands: wave }),
        obj("obj-disc-1", "Disc 1", "layer-fill", 30.0, 22.0, Shape::Ellipse { rx: 9.0, ry: 9.0 }),
        obj("obj-disc-2", "Disc 2", "layer-fill", 150.0, 72.0, Shape::Ellipse { rx: 9.0, ry: 9.0 }),
        obj(
            "obj-helix",
            "Helix stripe",
            "layer-outline",
            60.0,
            0.0,
            Shape::Line { points: vec![0.0, 0.0, 10.0, c], closed: false },
        ),
    ];

    Project {
        name: "Sample — wrapped tube".into(),
        mode: WorkspaceMode::Cylinder,
        document: Document { layers: vec![outline, fill], objects },
        workpiece,
        ..Default::default()
    }
}
