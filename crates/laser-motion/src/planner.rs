//! Strategy mapping: strokes in design/surface mm → machine segments.

use std::collections::BTreeMap;

use laser_core::{LaserSource, MachinePosition, MachineProfile};
use laser_geometry::{Bounds, CylinderTransform, Point};
use laser_project::{CylinderStrategy, Project, WorkspaceMode};

use crate::order::order_strokes;
use crate::segment::*;
use crate::strokes::{LayerStrokes, Stroke, collect};
use crate::timing::trapezoid_time;

const EPS: f64 = 1e-6;

struct Builder<'a> {
    profile: &'a MachineProfile,
    segs: Vec<MotionSegment>,
    pos: MachinePosition,
    surface_pos: Option<Point>,
    section: i32,
    layer: u32,
    source: LaserSource,
}

impl<'a> Builder<'a> {
    fn new(profile: &'a MachineProfile, start: MachinePosition) -> Self {
        Self { profile, segs: Vec::new(), pos: start, surface_pos: None, section: -1, layer: 0, source: LaserSource::Blue }
    }

    fn surface(&self, to: Option<Point>) -> Option<[f64; 4]> {
        match (self.surface_pos, to) {
            (Some(a), Some(b)) => Some([a.x, a.y, b.x, b.y]),
            _ => None,
        }
    }

    fn axis_time(&self, from: &MachinePosition, to: &MachinePosition) -> f64 {
        let r = &self.profile.rotary;
        let l = &self.profile.linear;
        trapezoid_time(to.a_deg - from.a_deg, r.max_velocity_deg_s, r.max_accel_deg_s2)
            .max(trapezoid_time(to.u_mm - from.u_mm, l.max_velocity_mm_s, l.max_accel_mm_s2))
    }

    fn push(&mut self, end: MachinePosition, kind: SegmentKind, sync: SyncKind, power: f64, speed: f64, duration: f64, surface_to: Option<Point>) {
        let surface = self.surface(surface_to);
        self.segs.push(MotionSegment {
            start: self.pos,
            end,
            kind,
            sync,
            laser_on: kind == SegmentKind::Mark && power > 0.0,
            power_pct: if kind == SegmentKind::Mark { power } else { 0.0 },
            speed_mm_s: speed,
            duration_s: duration,
            layer: self.layer,
            section: self.section,
            source: self.source,
            surface,
        });
        self.pos = end;
        self.surface_pos = surface_to;
    }

    /// Galvo-only travel (laser off).
    fn galvo_travel(&mut self, end: MachinePosition, surface_to: Option<Point>) {
        let d = self.pos.galvo_distance(&end);
        if d < EPS {
            self.surface_pos = surface_to.or(self.surface_pos);
            return;
        }
        let v = self.profile.galvo.max_travel_speed_mm_s;
        self.push(end, SegmentKind::Travel, SyncKind::None, 0.0, v, d / v, surface_to);
    }

    fn galvo_mark(&mut self, end: MachinePosition, power: f64, speed: f64, surface_to: Option<Point>) {
        let d = self.pos.galvo_distance(&end);
        if d < EPS {
            return;
        }
        let v = speed.min(self.profile.galvo.max_mark_speed_mm_s);
        self.push(end, SegmentKind::Mark, SyncKind::None, power, v, d / v, surface_to);
    }

    /// External-axis repositioning with the galvo parked and the laser off.
    fn barrier(&mut self, end: MachinePosition) {
        let t = self.axis_time(&self.pos.clone(), &end) + self.profile.external_settle_s;
        self.surface_pos = None;
        self.push(end, SegmentKind::Barrier, SyncKind::Barrier, 0.0, 0.0, t, None);
    }
}

fn galvo_center(p: &MachineProfile) -> (f64, f64) {
    (p.galvo.center_x_mm, p.galvo.center_y_mm)
}

fn overscan_points(s: &Stroke) -> Option<(Point, Point)> {
    if s.overscan_mm <= 0.0 || s.points.len() != 2 {
        return None;
    }
    let (a, b) = (s.points[0], s.points[1]);
    let len = a.distance(&b);
    if len < EPS {
        return None;
    }
    let (dx, dy) = ((b.x - a.x) / len * s.overscan_mm, (b.y - a.y) / len * s.overscan_mm);
    Some((Point::new(a.x - dx, a.y - dy), Point::new(b.x + dx, b.y + dy)))
}

pub fn plan(project: &Project) -> Toolpath {
    let (layers, mut warnings) = collect(project);
    let mut errors = Vec::new();
    if let Err(e) = project.machine.validate() {
        errors.push(format!("machine profile: {e}"));
    }
    let (strategy, segs, sections, simulation_only) = match project.mode {
        WorkspaceMode::Flat => {
            let segs = plan_flat(project, &layers, &mut errors);
            (None, segs, Vec::new(), false)
        }
        WorkspaceMode::Cylinder => {
            if let Err(e) = project.workpiece.validate() {
                errors.push(format!("workpiece: {e}"));
            }
            match project.cylinder.strategy {
                CylinderStrategy::Indexed => {
                    let (segs, sections) = plan_indexed(project, &layers, &mut errors, &mut warnings);
                    (Some(CylinderStrategy::Indexed), segs, sections, false)
                }
                CylinderStrategy::Coupled => {
                    warnings.push(
                        "Coupled strategy is EXPERIMENTAL and simulation-only: synchronized A/U motion \
                         with laser emission has not been validated on hardware."
                            .into(),
                    );
                    let segs = plan_coupled(project, &layers, &mut errors, &mut warnings);
                    (Some(CylinderStrategy::Coupled), segs, Vec::new(), true)
                }
            }
        }
    };
    let stats = compute_stats(&segs, sections.len());
    if segs.is_empty() && errors.is_empty() {
        warnings.push("Nothing to engrave: no visible objects on output layers.".into());
    }
    if !project.machine.limits_validated {
        warnings.push("Machine velocity/acceleration limits are unvalidated placeholders; time estimates are approximate.".into());
    }
    Toolpath { mode: project.mode, strategy, segments: segs, sections, stats, warnings, errors, simulation_only }
}

fn plan_flat(project: &Project, layers: &[LayerStrokes], errors: &mut Vec<String>) -> Vec<MotionSegment> {
    let p = &project.machine;
    let g = &p.galvo;
    let (cx, cy) = galvo_center(p);
    let map = |pt: Point| MachinePosition {
        gx_mm: if g.invert_x { g.field_width_mm - pt.x } else { pt.x },
        gy_mm: if g.invert_y { g.field_height_mm - pt.y } else { pt.y },
        a_deg: 0.0,
        u_mm: 0.0,
    };
    let mut b = Builder::new(p, MachinePosition::new(cx, cy, 0.0, 0.0));
    let field = Bounds::new(0.0, 0.0, g.field_width_mm, g.field_height_mm);
    let mut cursor = Point::new(cx, cy);
    let mut out_of_field = false;
    for layer in layers {
        b.layer = layer.layer;
        for s in order_strokes(layer.strokes.clone(), cursor) {
            b.source = s.source;
            if !field.contains_bounds(&Bounds::from_points(&s.points), 1e-6) {
                out_of_field = true;
            }
            emit_stroke(&mut b, &s, &|pt| (map(pt), None));
            cursor = s.end();
        }
    }
    if out_of_field {
        errors.push(format!(
            "Design exceeds the galvo field ({} x {} mm).",
            g.field_width_mm, g.field_height_mm
        ));
    }
    b.segs
}

/// Emit travel + marks for a stroke using `map` (design point → machine + surface point).
fn emit_stroke(b: &mut Builder, s: &Stroke, map: &dyn Fn(Point) -> (MachinePosition, Option<Point>)) {
    let path = s.path();
    if let Some((lead, tail)) = overscan_points(s) {
        let (m, sp) = map(lead);
        b.galvo_travel(m, sp);
        let (m, sp) = map(path[0]);
        b.galvo_travel(m, sp);
        for pt in &path[1..] {
            let (m, sp) = map(*pt);
            b.galvo_mark(m, s.power_pct, s.speed_mm_s, sp);
        }
        let (m, sp) = map(tail);
        b.galvo_travel(m, sp);
        return;
    }
    let (m, sp) = map(path[0]);
    b.galvo_travel(m, sp);
    for pt in &path[1..] {
        let (m, sp) = map(*pt);
        b.galvo_mark(m, s.power_pct, s.speed_mm_s, sp);
    }
}

type Cell = (i64, i64);

struct Grid {
    u0: f64,
    s0: f64,
    w: f64,
    h: f64,
}

impl Grid {
    fn cell(&self, p: Point) -> Cell {
        (((p.x - self.u0) / self.w).floor() as i64, ((p.y - self.s0) / self.h).floor() as i64)
    }

    fn cell_bounds(&self, c: Cell) -> Bounds {
        let x0 = self.u0 + c.0 as f64 * self.w;
        let y0 = self.s0 + c.1 as f64 * self.h;
        Bounds::new(x0, y0, x0 + self.w, y0 + self.h)
    }

    /// Split a stroke at cell boundaries unless it stays within the start cell + overlap.
    fn split(&self, s: &Stroke, overlap: f64) -> Vec<(Cell, Stroke)> {
        let start_cell = self.cell(s.points[0]);
        let cb = self.cell_bounds(start_cell);
        let expanded = Bounds::new(cb.min_x - overlap, cb.min_y - overlap, cb.max_x + overlap, cb.max_y + overlap);
        if expanded.contains_bounds(&Bounds::from_points(&s.points), 1e-9) {
            return vec![(start_cell, s.clone())];
        }
        let path = s.path();
        let mut pieces: Vec<(Cell, Vec<Point>)> = Vec::new();
        for w in path.windows(2) {
            let (a, bpt) = (w[0], w[1]);
            let mut ts = vec![0.0, 1.0];
            let crossings = |a0: f64, a1: f64, origin: f64, step: f64, ts: &mut Vec<f64>| {
                if (a1 - a0).abs() < 1e-12 {
                    return;
                }
                let k0 = ((a0.min(a1) - origin) / step).floor() as i64;
                let k1 = ((a0.max(a1) - origin) / step).ceil() as i64;
                for k in k0..=k1 {
                    let line = origin + k as f64 * step;
                    let t = (line - a0) / (a1 - a0);
                    if t > 1e-12 && t < 1.0 - 1e-12 {
                        ts.push(t);
                    }
                }
            };
            crossings(a.x, bpt.x, self.u0, self.w, &mut ts);
            crossings(a.y, bpt.y, self.s0, self.h, &mut ts);
            ts.sort_by(f64::total_cmp);
            ts.dedup_by(|x, y| (*x - *y).abs() < 1e-12);
            for t in ts.windows(2) {
                let p0 = a.lerp(&bpt, t[0]);
                let p1 = a.lerp(&bpt, t[1]);
                let cell = self.cell(p0.lerp(&p1, 0.5));
                match pieces.last_mut() {
                    Some((c, pts)) if *c == cell && pts.last().is_some_and(|l| l.distance(&p0) < 1e-9) => pts.push(p1),
                    _ => pieces.push((cell, vec![p0, p1])),
                }
            }
        }
        pieces
            .into_iter()
            .map(|(c, pts)| (c, Stroke { points: pts, closed: false, reorderable: false, ..s.clone() }))
            .collect()
    }
}

fn plan_indexed(
    project: &Project,
    layers: &[LayerStrokes],
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> (Vec<MotionSegment>, Vec<Section>) {
    let p = &project.machine;
    let g = &p.galvo;
    let job = &project.cylinder;
    let cyl = CylinderTransform::new(project.workpiece);
    let (cx, cy) = galvo_center(p);

    let w = job.section_width_mm.min(g.field_width_mm - 2.0).max(1.0);
    // Strokes may overhang a section by the overlap, so the focus budget must include it.
    let overlap = job.section_overlap_mm.max(0.0);
    let derived = 2.0 * (cyl.max_arc_half_window(job.max_focus_error_mm.max(0.01)) - overlap);
    let h = if job.angular_window_mm > 0.0 { job.angular_window_mm } else { derived }
        .min(g.field_height_mm - 2.0)
        .min(cyl.circumference())
        .max(0.5);

    let all: Vec<&Stroke> = layers.iter().flat_map(|l| l.strokes.iter()).collect();
    if all.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let content = all.iter().fold(Bounds::EMPTY, |acc, s| acc.union(&Bounds::from_points(&s.points)));
    if content.min_x < -EPS || content.max_x > project.workpiece.length_mm + EPS {
        warnings.push(format!(
            "Artwork extends beyond the cylinder length (u = {:.1}..{:.1} mm, length {:.1} mm).",
            content.min_x, content.max_x, project.workpiece.length_mm
        ));
    }
    let grid = Grid { u0: content.min_x, s0: content.min_y, w, h };

    // cell → layer → strokes, preserving layer order.
    let mut cells: BTreeMap<Cell, BTreeMap<u32, Vec<Stroke>>> = BTreeMap::new();
    for layer in layers {
        for s in &layer.strokes {
            for (c, piece) in grid.split(s, overlap) {
                cells.entry(c).or_default().entry(layer.layer).or_default().push(piece);
            }
        }
    }
    // Serpentine section order: by axial column, alternating circumferential direction.
    let mut order: Vec<Cell> = cells.keys().copied().collect();
    order.sort_by(|a, b| a.0.cmp(&b.0).then(if a.0 % 2 == 0 { a.1.cmp(&b.1) } else { b.1.cmp(&a.1) }));

    let start = MachinePosition::new(cx, cy, cyl.s_to_a_deg(0.0), cyl.u_to_machine_u(0.0));
    let mut b = Builder::new(p, start);
    let mut sections = Vec::new();
    let sx = if g.invert_x { -1.0 } else { 1.0 };
    let sy = if g.invert_y { -1.0 } else { 1.0 };
    let field = Bounds::new(0.0, 0.0, g.field_width_mm, g.field_height_mm);
    let mut travel_violation = false;
    let mut field_violation = false;

    for (idx, cell) in order.iter().enumerate() {
        let cb = grid.cell_bounds(*cell);
        let uc = (cb.min_x + cb.max_x) / 2.0;
        let sc = (cb.min_y + cb.max_y) / 2.0;
        let a = cyl.s_to_a_deg(sc);
        let mu = cyl.u_to_machine_u(uc);
        if mu < p.linear.travel_min_mm - EPS || mu > p.linear.travel_max_mm + EPS {
            travel_violation = true;
        }
        // Park galvo, then move external axes (barrier).
        b.section = idx as i32;
        b.galvo_travel(MachinePosition { gx_mm: cx, gy_mm: cy, ..b.pos }, None);
        b.barrier(MachinePosition::new(cx, cy, a, mu));
        let first = b.segs.len();
        let map = |pt: Point| {
            let m = MachinePosition::new(cx + sx * (pt.x - uc), cy + sy * cyl.arc_to_galvo_offset(pt.y - sc), a, mu);
            (m, Some(pt))
        };
        let mut cursor = Point::new(uc, sc);
        let mut max_ds: f64 = 0.0;
        for (layer, strokes) in &cells[cell] {
            b.layer = *layer;
            for s in order_strokes(strokes.clone(), cursor) {
                b.source = s.source;
                for pt in &s.points {
                    max_ds = max_ds.max((pt.y - sc).abs());
                    let (m, _) = map(*pt);
                    if !field.contains_bounds(&Bounds::new(m.gx_mm, m.gy_mm, m.gx_mm, m.gy_mm), 1e-6) {
                        field_violation = true;
                    }
                }
                emit_stroke(&mut b, &s, &map);
                cursor = s.end();
            }
        }
        sections.push(Section {
            index: idx as u32,
            u_center_mm: uc,
            s_center_mm: sc,
            a_deg: a,
            machine_u_mm: mu,
            surface_bounds: cb,
            first_segment: first,
            segment_count: b.segs.len() - first,
            max_focus_error_mm: cyl.focus_error_mm(max_ds),
        });
    }
    // Return galvo to center at the end.
    b.galvo_travel(MachinePosition { gx_mm: cx, gy_mm: cy, ..b.pos }, None);
    if travel_violation {
        errors.push(format!(
            "Linear axis travel exceeded: sections require U outside {:.1}..{:.1} mm.",
            p.linear.travel_min_mm, p.linear.travel_max_mm
        ));
    }
    if field_violation {
        errors.push("Section content exceeds the galvo field; reduce section width or overlap.".into());
    }
    let worst = sections.iter().map(|s| s.max_focus_error_mm).fold(0.0, f64::max);
    if worst > job.max_focus_error_mm + 1e-6 {
        warnings.push(format!(
            "Focus error reaches {worst:.2} mm (limit {:.2} mm); reduce the angular window.",
            job.max_focus_error_mm
        ));
    }
    (b.segs, sections)
}

fn plan_coupled(
    project: &Project,
    layers: &[LayerStrokes],
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Vec<MotionSegment> {
    let p = &project.machine;
    let cyl = CylinderTransform::new(project.workpiece);
    let (cx, cy) = galvo_center(p);
    let map = |pt: Point| MachinePosition::new(cx, cy, cyl.s_to_a_deg(pt.y), cyl.u_to_machine_u(pt.x));
    let mut b = Builder::new(p, map(Point::new(0.0, 0.0)));
    b.surface_pos = Some(Point::new(0.0, 0.0));
    let mut cursor = Point::new(0.0, 0.0);
    let mut axis_limited = false;
    let mut travel_violation = false;
    for layer in layers {
        b.layer = layer.layer;
        for s in order_strokes(layer.strokes.clone(), cursor) {
            b.source = s.source;
            let path = s.path();
            for (i, pt) in path.iter().enumerate() {
                let end = map(*pt);
                if end.u_mm < p.linear.travel_min_mm - EPS || end.u_mm > p.linear.travel_max_mm + EPS {
                    travel_violation = true;
                }
                let from = b.pos;
                if i == 0 {
                    if from.a_deg != end.a_deg || from.u_mm != end.u_mm {
                        let t = b.axis_time(&from, &end);
                        b.push(end, SegmentKind::Travel, SyncKind::Barrier, 0.0, 0.0, t, Some(*pt));
                    }
                    continue;
                }
                let d = b.surface_pos.map(|sp| sp.distance(pt)).unwrap_or(0.0);
                if d < EPS {
                    continue;
                }
                let t_surface = d / s.speed_mm_s;
                let t_a = (end.a_deg - from.a_deg).abs() / p.rotary.max_velocity_deg_s;
                let t_u = (end.u_mm - from.u_mm).abs() / p.linear.max_velocity_mm_s;
                let t = t_surface.max(t_a).max(t_u);
                if t > t_surface * 1.0001 {
                    axis_limited = true;
                }
                b.push(end, SegmentKind::Mark, SyncKind::Coupled, s.power_pct, d / t, t, Some(*pt));
            }
            cursor = s.end();
        }
    }
    if axis_limited {
        warnings.push("Some coupled segments are slowed by rotary/linear velocity limits.".into());
    }
    if travel_violation {
        errors.push(format!(
            "Linear axis travel exceeded ({:.1}..{:.1} mm).",
            p.linear.travel_min_mm, p.linear.travel_max_mm
        ));
    }
    b.segs
}

fn compute_stats(segs: &[MotionSegment], sections: usize) -> ToolpathStats {
    let mut st = ToolpathStats { segment_count: segs.len(), section_count: sections, ..Default::default() };
    let mut gb = Bounds::EMPTY;
    let mut a_range = [f64::INFINITY, f64::NEG_INFINITY];
    let mut u_range = [f64::INFINITY, f64::NEG_INFINITY];
    for s in segs {
        let len = match s.surface {
            Some([u0, s0, u1, s1]) if s.sync == SyncKind::Coupled => (u1 - u0).hypot(s1 - s0),
            _ => s.start.galvo_distance(&s.end),
        };
        match s.kind {
            SegmentKind::Mark => st.mark_length_mm += len,
            SegmentKind::Travel => st.travel_length_mm += len,
            _ => {}
        }
        st.estimated_time_s += s.duration_s;
        for p in [s.start, s.end] {
            gb.include(Point::new(p.gx_mm, p.gy_mm));
            a_range = [a_range[0].min(p.a_deg), a_range[1].max(p.a_deg)];
            u_range = [u_range[0].min(p.u_mm), u_range[1].max(p.u_mm)];
        }
    }
    if !segs.is_empty() {
        st.galvo_bounds = Some(gb);
        st.a_range_deg = Some(a_range);
        st.u_range_mm = Some(u_range);
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;
    use laser_project::sample::sample_project;
    use laser_project::{DesignObject, Document, Layer, Shape, Transform2};

    fn rect_project(mode: WorkspaceMode, x: f64, y: f64, w: f64, h: f64) -> Project {
        Project {
            mode,
            document: Document {
                layers: vec![Layer::default()],
                objects: vec![DesignObject {
                    id: "r".into(),
                    name: "r".into(),
                    layer_id: "layer-1".into(),
                    visible: true,
                    locked: false,
                    group_id: None,
                    transform: Transform2 { x, y, ..Default::default() },
                    shape: Shape::Rect { width: w, height: h },
                }],
            },
            ..Default::default()
        }
    }

    #[test]
    fn flat_rectangle() {
        let tp = plan(&rect_project(WorkspaceMode::Flat, 10.0, 10.0, 20.0, 10.0));
        assert!(tp.errors.is_empty(), "{:?}", tp.errors);
        assert!((tp.stats.mark_length_mm - 60.0).abs() < 1e-9);
        assert!(tp.segments.iter().all(|s| s.start.a_deg == 0.0 && s.end.u_mm == 0.0));
        assert!(tp.segments.iter().filter(|s| s.kind == SegmentKind::Mark).all(|s| s.laser_on));
        assert!(tp.segments.iter().filter(|s| s.kind != SegmentKind::Mark).all(|s| !s.laser_on));
    }

    #[test]
    fn flat_out_of_field_is_error() {
        let tp = plan(&rect_project(WorkspaceMode::Flat, 100.0, 100.0, 50.0, 50.0));
        assert!(!tp.errors.is_empty());
        assert!(!tp.is_executable());
    }

    #[test]
    fn indexed_never_moves_axes_while_marking() {
        let tp = plan(&sample_project());
        assert!(tp.errors.is_empty(), "{:?}", tp.errors);
        assert!(tp.sections.len() > 1);
        for s in &tp.segments {
            if s.laser_on {
                assert_eq!(s.start.a_deg, s.end.a_deg);
                assert_eq!(s.start.u_mm, s.end.u_mm);
                assert_eq!(s.sync, SyncKind::None);
            }
            if s.kind == SegmentKind::Barrier {
                assert!(!s.laser_on);
                assert_eq!((s.start.gx_mm, s.start.gy_mm), (s.end.gx_mm, s.end.gy_mm));
            }
        }
    }

    #[test]
    fn indexed_section_positions_match_cylinder_transform() {
        let p = sample_project();
        let cyl = CylinderTransform::new(p.workpiece);
        let tp = plan(&p);
        for sec in &tp.sections {
            assert!((sec.a_deg - cyl.s_to_a_deg(sec.s_center_mm)).abs() < 1e-9);
            for seg in &tp.segments[sec.first_segment..sec.first_segment + sec.segment_count] {
                if let Some([u0, s0, ..]) = seg.surface {
                    // Galvo X offset equals axial offset from section center.
                    assert!((seg.start.gx_mm - p.machine.galvo.center_x_mm - (u0 - sec.u_center_mm)).abs() < 1e-6);
                    let ds = cyl.galvo_offset_to_arc(seg.start.gy_mm - p.machine.galvo.center_y_mm);
                    assert!((ds - (s0 - sec.s_center_mm)).abs() < 1e-6);
                }
            }
            assert!(sec.max_focus_error_mm <= p.cylinder.max_focus_error_mm + 1e-6);
        }
    }

    #[test]
    fn indexed_preserves_mark_length() {
        let mut p = rect_project(WorkspaceMode::Cylinder, 5.0, 5.0, 150.0, 60.0);
        p.workpiece.length_mm = 200.0;
        let tp = plan(&p);
        assert!(tp.errors.is_empty(), "{:?}", tp.errors);
        // Surface length is preserved; galvo length differs slightly due to arc projection.
        let surface_len: f64 = tp
            .segments
            .iter()
            .filter(|s| s.kind == SegmentKind::Mark)
            .map(|s| s.surface.map(|[a, b, c, d]| (c - a).hypot(d - b)).unwrap_or(0.0))
            .sum();
        assert!((surface_len - 420.0).abs() < 1e-6, "{surface_len}");
    }

    #[test]
    fn indexed_travel_limit_error() {
        let mut p = rect_project(WorkspaceMode::Cylinder, 0.0, 0.0, 400.0, 10.0);
        p.workpiece.length_mm = 500.0;
        let tp = plan(&p);
        assert!(tp.errors.iter().any(|e| e.contains("Linear axis travel")));
    }

    #[test]
    fn coupled_is_simulation_only_and_tracks_surface() {
        let mut p = sample_project();
        p.cylinder.strategy = CylinderStrategy::Coupled;
        let tp = plan(&p);
        assert!(tp.simulation_only);
        let cyl = CylinderTransform::new(p.workpiece);
        for s in tp.segments.iter().filter(|s| s.kind == SegmentKind::Mark) {
            let [_, _, u1, s1] = s.surface.unwrap();
            assert!((s.end.a_deg - cyl.s_to_a_deg(s1)).abs() < 1e-9);
            assert!((s.end.u_mm - cyl.u_to_machine_u(u1)).abs() < 1e-9);
            assert_eq!(s.end.gx_mm, p.machine.galvo.center_x_mm);
        }
    }

    #[test]
    fn deterministic() {
        let p = sample_project();
        assert_eq!(plan(&p), plan(&p));
    }
}
