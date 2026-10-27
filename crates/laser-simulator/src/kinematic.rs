//! Kinematic playback: samples a planned toolpath on the planner's own timing model.
//! No device model, latency or protocol — used for fast preview and for strategies that no
//! device simulation supports (coupled).

use laser_core::{MachineProfile, MachinePosition, SafetyState};
use laser_motion::timing::trapezoid_fraction;
use laser_motion::{MotionSegment, SegmentKind, Toolpath};

use crate::timeline::{Sample, Timeline};

fn position_at(s: &MotionSegment, profile: &MachineProfile, local_t: f64) -> MachinePosition {
    if s.kind == SegmentKind::Barrier {
        let (r, l) = (&profile.rotary, &profile.linear);
        let da = s.end.a_deg - s.start.a_deg;
        let du = s.end.u_mm - s.start.u_mm;
        let fa = trapezoid_fraction(da, r.max_velocity_deg_s, r.max_accel_deg_s2, local_t);
        let fu = trapezoid_fraction(du, l.max_velocity_mm_s, l.max_accel_mm_s2, local_t);
        MachinePosition { gx_mm: s.end.gx_mm, gy_mm: s.end.gy_mm, a_deg: s.start.a_deg + da * fa, u_mm: s.start.u_mm + du * fu }
    } else {
        let f = if s.duration_s > 0.0 { (local_t / s.duration_s).clamp(0.0, 1.0) } else { 1.0 };
        s.start.lerp(&s.end, f)
    }
}

pub fn kinematic_timeline(tp: &Toolpath, profile: &MachineProfile, sample_dt: f64) -> Timeline {
    let dt = sample_dt.max(1e-4);
    let mut tl = Timeline::default();
    let mut t0 = 0.0;
    for (i, s) in tp.segments.iter().enumerate() {
        let d = s.duration_s.max(0.0);
        let n = ((d / dt).ceil() as usize).max(1);
        if s.kind == SegmentKind::Barrier {
            tl.event(t0, "barrier", format!("external move to A={:.3} U={:.3}", s.end.a_deg, s.end.u_mm));
        }
        for k in 0..n {
            let local = d * k as f64 / n as f64;
            tl.push(Sample {
                t_s: t0 + local,
                pos: position_at(s, profile, local),
                laser_on: s.laser_on,
                power_pct: s.power_pct,
                state: SafetyState::Running,
                section: s.section,
                segment: i as i32,
            });
        }
        t0 += d;
    }
    if let Some(last) = tp.segments.last() {
        tl.push(Sample {
            t_s: t0,
            pos: last.end,
            laser_on: false,
            power_pct: 0.0,
            state: SafetyState::Idle,
            section: last.section,
            segment: tp.segments.len() as i32 - 1,
        });
        tl.event(t0, "complete", "toolpath complete");
    }
    tl
}

#[cfg(test)]
mod tests {
    use super::*;
    use laser_motion::plan;
    use laser_project::sample::sample_project;

    #[test]
    fn duration_matches_estimate_and_ends_dark() {
        let p = sample_project();
        let tp = plan(&p);
        let tl = kinematic_timeline(&tp, &p.machine, 0.01);
        assert!((tl.duration() - tp.stats.estimated_time_s).abs() < 1e-6);
        assert!(!tl.samples.last().unwrap().laser_on);
        assert!(tl.samples.windows(2).all(|w| w[1].t_s >= w[0].t_s));
    }
}
