use laser_core::Result;

use crate::{AxisDevice, Capabilities, DeviceEvent, LaserDevice};

/// The complete machine: galvo laser plus optional external axes.
pub struct CompositeMachineDevice {
    pub laser: Box<dyn LaserDevice>,
    pub axes: Option<Box<dyn AxisDevice>>,
}

impl CompositeMachineDevice {
    pub fn new(laser: Box<dyn LaserDevice>, axes: Option<Box<dyn AxisDevice>>) -> Self {
        Self { laser, axes }
    }

    pub fn capabilities(&self) -> Capabilities {
        let mut c = self.laser.capabilities();
        if let Some(a) = &self.axes {
            let ac = a.capabilities();
            c.rotary = ac.rotary;
            c.linear = ac.linear;
        }
        c
    }

    pub fn is_connected(&self) -> bool {
        self.laser.is_connected() && self.axes.as_ref().is_none_or(|a| a.is_connected())
    }

    pub fn poll(&mut self) -> Vec<DeviceEvent> {
        let mut ev = self.laser.poll();
        if let Some(a) = self.axes.as_mut() {
            ev.extend(a.poll());
        }
        ev
    }

    /// Stop everything. Both devices are always attempted; the first error is returned.
    pub fn stop_all(&mut self) -> Result<()> {
        let r1 = self.laser.stop();
        let r2 = self.axes.as_mut().map(|a| a.stop().map(|_| ())).unwrap_or(Ok(()));
        r1.and(r2)
    }

    pub fn emergency_stop(&mut self) -> Result<()> {
        self.laser.set_emission_permitted(false);
        let r1 = self.laser.emergency_stop();
        let r2 = self.axes.as_mut().map(|a| a.emergency_stop().map(|_| ())).unwrap_or(Ok(()));
        r1.and(r2)
    }
}
