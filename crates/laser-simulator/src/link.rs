//! In-memory links between host-side drivers and simulated hardware. Drivers own a
//! [`HostEnd`] exactly as they would own a TCP socket or serial port; [`crate::SimWorld`]
//! pumps the device ends. No locks are held across calls, so drivers and the world never
//! contend for a shared world lock.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct PipeInner {
    to_device: VecDeque<u8>,
    to_host: VecDeque<u8>,
}

#[derive(Clone)]
struct Pipe {
    inner: Arc<Mutex<PipeInner>>,
    up: Arc<AtomicBool>,
}

/// Host side of a simulated byte link.
#[derive(Clone)]
pub struct HostEnd(Pipe);

/// Device side of a simulated byte link (owned by the world).
#[derive(Clone)]
pub struct DeviceEnd(Pipe);

pub fn pipe() -> (HostEnd, DeviceEnd) {
    let p = Pipe { inner: Arc::default(), up: Arc::new(AtomicBool::new(true)) };
    (HostEnd(p.clone()), DeviceEnd(p))
}

fn lock(p: &Pipe) -> std::sync::MutexGuard<'_, PipeInner> {
    p.inner.lock().unwrap_or_else(|e| e.into_inner())
}

impl HostEnd {
    /// Returns false when the link is down (bytes are discarded, like a dead socket).
    pub fn write(&self, data: &[u8]) -> bool {
        if !self.is_up() {
            return false;
        }
        lock(&self.0).to_device.extend(data);
        true
    }

    pub fn read(&self) -> Vec<u8> {
        lock(&self.0).to_host.drain(..).collect()
    }

    pub fn is_up(&self) -> bool {
        self.0.up.load(Ordering::SeqCst)
    }
}

impl DeviceEnd {
    pub fn read(&self) -> Vec<u8> {
        lock(&self.0).to_device.drain(..).collect()
    }

    pub fn write(&self, data: &[u8]) {
        if self.is_up() {
            lock(&self.0).to_host.extend(data);
        }
    }

    pub fn set_up(&self, up: bool) {
        self.0.up.store(up, Ordering::SeqCst);
        if !up {
            let mut g = lock(&self.0);
            g.to_device.clear();
            g.to_host.clear();
        }
    }

    pub fn is_up(&self) -> bool {
        self.0.up.load(Ordering::SeqCst)
    }
}

/// Simulated monotonic clock shared between the world and drivers.
#[derive(Clone, Default)]
pub struct SimClock(Arc<AtomicU64>);

impl SimClock {
    pub fn now(&self) -> f64 {
        f64::from_bits(self.0.load(Ordering::SeqCst))
    }

    pub fn set(&self, t: f64) {
        self.0.store(t.to_bits(), Ordering::SeqCst);
    }
}

/// Out-of-band F1 requests (the HTTP side of the real device).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum F1Control {
    Stop,
    Pause,
    Resume,
    EmergencyStop,
    ResetEstop,
}

/// What the simulated F1 reports through its status endpoint.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct F1StatusSnapshot {
    pub working: bool,
    pub paused: bool,
    pub estop: bool,
    pub gx: f64,
    pub gy: f64,
    pub lines_rejected: u64,
}

#[derive(Clone, Default)]
pub struct F1StatusCell(Arc<Mutex<F1StatusSnapshot>>);

impl F1StatusCell {
    pub fn get(&self) -> F1StatusSnapshot {
        *self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set(&self, s: F1StatusSnapshot) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = s;
    }
}

#[derive(Clone, Default)]
pub struct ControlChannel(Arc<Mutex<VecDeque<F1Control>>>);

impl ControlChannel {
    pub fn send(&self, c: F1Control) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).push_back(c);
    }

    pub fn drain(&self) -> Vec<F1Control> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).drain(..).collect()
    }
}
