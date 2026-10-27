use serde::{Deserialize, Serialize};

use crate::Point;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Bounds {
    pub const EMPTY: Bounds =
        Bounds { min_x: f64::INFINITY, min_y: f64::INFINITY, max_x: f64::NEG_INFINITY, max_y: f64::NEG_INFINITY };

    pub fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self { min_x, min_y, max_x, max_y }
    }

    pub fn is_empty(&self) -> bool {
        self.min_x > self.max_x || self.min_y > self.max_y
    }

    pub fn include(&mut self, p: Point) {
        self.min_x = self.min_x.min(p.x);
        self.min_y = self.min_y.min(p.y);
        self.max_x = self.max_x.max(p.x);
        self.max_y = self.max_y.max(p.y);
    }

    pub fn union(&self, o: &Bounds) -> Bounds {
        Bounds {
            min_x: self.min_x.min(o.min_x),
            min_y: self.min_y.min(o.min_y),
            max_x: self.max_x.max(o.max_x),
            max_y: self.max_y.max(o.max_y),
        }
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    pub fn contains_bounds(&self, o: &Bounds, eps: f64) -> bool {
        o.min_x >= self.min_x - eps
            && o.min_y >= self.min_y - eps
            && o.max_x <= self.max_x + eps
            && o.max_y <= self.max_y + eps
    }

    pub fn from_points<'a>(pts: impl IntoIterator<Item = &'a Point>) -> Bounds {
        let mut b = Bounds::EMPTY;
        for p in pts {
            b.include(*p);
        }
        b
    }
}
