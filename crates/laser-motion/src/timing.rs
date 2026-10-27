//! Time estimates. Galvo acceleration is not modelled (unknown for the F1); external axes use
//! a trapezoidal profile with limits taken from the machine profile, never invented here.

/// Duration of a point-to-point move of `distance` with max velocity `v` and acceleration `a`.
pub fn trapezoid_time(distance: f64, v: f64, a: f64) -> f64 {
    let d = distance.abs();
    if d <= 0.0 {
        return 0.0;
    }
    let v = v.max(1e-9);
    let a = a.max(1e-9);
    let d_accel = v * v / a;
    if d < d_accel {
        2.0 * (d / a).sqrt()
    } else {
        d / v + v / a
    }
}

/// Position along a trapezoidal move at time `t` (0..=total). Returns the fraction 0..=1.
pub fn trapezoid_fraction(distance: f64, v: f64, a: f64, t: f64) -> f64 {
    let d = distance.abs();
    if d <= 0.0 {
        return 1.0;
    }
    let total = trapezoid_time(d, v, a);
    let t = t.clamp(0.0, total);
    let v = v.max(1e-9);
    let a = a.max(1e-9);
    let pos = if d < v * v / a {
        let half = total / 2.0;
        if t <= half {
            0.5 * a * t * t
        } else {
            let tr = total - t;
            d - 0.5 * a * tr * tr
        }
    } else {
        let ta = v / a;
        if t <= ta {
            0.5 * a * t * t
        } else if t <= total - ta {
            0.5 * a * ta * ta + v * (t - ta)
        } else {
            let tr = total - t;
            d - 0.5 * a * tr * tr
        }
    };
    (pos / d).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangle_and_trapezoid() {
        // v=10, a=10 → accel distance 10 (5 up + 5 down).
        assert!((trapezoid_time(4.0, 10.0, 10.0) - 2.0 * (0.4f64).sqrt()).abs() < 1e-12);
        assert!((trapezoid_time(30.0, 10.0, 10.0) - 4.0).abs() < 1e-12);
        assert_eq!(trapezoid_time(0.0, 10.0, 10.0), 0.0);
    }

    #[test]
    fn fraction_monotonic_and_complete() {
        for d in [1.0, 30.0] {
            let total = trapezoid_time(d, 10.0, 10.0);
            let mut last = 0.0;
            for i in 0..=100 {
                let f = trapezoid_fraction(d, 10.0, 10.0, total * f64::from(i) / 100.0);
                assert!(f >= last - 1e-12);
                last = f;
            }
            assert!((last - 1.0).abs() < 1e-9);
        }
    }
}
