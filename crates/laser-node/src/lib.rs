//! Node-API bridge. Loaded only by the Electron main process (never the renderer).
//!
//! Conventions:
//! - Errors are thrown as `Error("[CODE] message")` where CODE is `CoreError::code()`.
//! - Structured data crosses as plain JS objects (serde); bulk numeric data as typed arrays.
//! - Long computations are `AsyncTask`s on the libuv pool and accept an optional `AbortSignal`.
//! - `nativeInfo().apiVersion` must match the version the JS side was built against.

#![allow(clippy::needless_pass_by_value)]

use napi::bindgen_prelude::{AbortSignal, AsyncTask, Buffer, Float32Array, Float64Array, Uint32Array};
use napi::{Env, Error, Status, Task};
use napi_derive::napi;
use serde::Serialize;
use serde_json::Value;

use laser_core::{CoreError, CylinderSpec, NATIVE_API_VERSION};
use laser_geometry::CylinderTransform;
use laser_jobs::SimSession as CoreSession;
use laser_motion::{SegmentKind, Toolpath, build_overlay, emit_f1, plan};
use laser_project::Project;
use laser_simulator::{Injection, SimConfig, TimelineExport, kinematic_timeline};

fn err(e: CoreError) -> Error {
    Error::new(Status::GenericFailure, format!("[{}] {e}", e.code()))
}

fn invalid(msg: impl std::fmt::Display) -> Error {
    err(CoreError::InvalidArgument(msg.to_string()))
}

fn from_value<T: serde::de::DeserializeOwned>(v: Value, what: &str) -> napi::Result<T> {
    serde_json::from_value(v).map_err(|e| invalid(format!("{what}: {e}")))
}

fn to_value<T: Serialize>(v: &T) -> napi::Result<Value> {
    serde_json::to_value(v).map_err(|e| err(CoreError::from(e)))
}

#[napi(object)]
pub struct NativeInfo {
    pub api_version: u32,
    pub version: String,
    pub target: String,
}

#[napi]
pub fn native_info() -> NativeInfo {
    NativeInfo {
        api_version: NATIVE_API_VERSION,
        version: env!("CARGO_PKG_VERSION").to_string(),
        target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
    }
}

#[napi]
pub fn sample_project() -> napi::Result<Value> {
    to_value(&laser_project::sample::sample_project())
}

#[napi]
pub fn default_machine_profile() -> napi::Result<Value> {
    to_value(&laser_core::MachineProfile::default())
}

/// Parse + validate a project; returns the normalized project (defaults filled in).
#[napi]
pub fn normalize_project(project: Value) -> napi::Result<Value> {
    let p: Project = from_value(project, "project")?;
    p.machine.validate().map_err(err)?;
    p.workpiece.validate().map_err(err)?;
    to_value(&p)
}

// ---------------------------------------------------------------- geometry

#[napi(object)]
pub struct MeshBuffers {
    pub positions: Float32Array,
    pub normals: Float32Array,
    pub uvs: Float32Array,
    pub indices: Uint32Array,
    pub radial_segments: u32,
    pub axial_segments: u32,
}

#[napi]
pub fn cylinder_mesh(spec: Value, tolerance_mm: f64, axial_segments: u32) -> napi::Result<MeshBuffers> {
    let spec: CylinderSpec = from_value(spec, "cylinder")?;
    spec.validate().map_err(err)?;
    let m = CylinderTransform::new(spec).mesh(tolerance_mm.max(0.005), axial_segments.clamp(1, 512));
    Ok(MeshBuffers {
        positions: Float32Array::new(m.positions),
        normals: Float32Array::new(m.normals),
        uvs: Float32Array::new(m.uvs),
        indices: Uint32Array::new(m.indices),
        radial_segments: m.radial_segments,
        axial_segments: m.axial_segments,
    })
}

/// Rigid transform taking a CAD cylinder axis to the rotary workpiece frame (Rust owns it).
#[napi]
pub fn cad_align_to_rotary(params: Value) -> napi::Result<Value> {
    let p: laser_geometry::AlignParams = from_value(params, "alignment")?;
    to_value(&laser_geometry::align_axis_to_rotary(&p).map_err(err)?)
}

#[napi(object)]
pub struct MachineAu {
    pub a_deg: f64,
    pub u_mm: f64,
}

#[napi]
pub fn surface_to_machine(spec: Value, u_mm: f64, s_mm: f64) -> napi::Result<MachineAu> {
    let spec: CylinderSpec = from_value(spec, "cylinder")?;
    let (a, u) = CylinderTransform::new(spec).surface_to_machine(u_mm, s_mm);
    Ok(MachineAu { a_deg: a, u_mm: u })
}

#[napi(object)]
pub struct Pose {
    pub rotation_x_rad: f64,
    pub translation_x_mm: f64,
}

#[napi]
pub fn cylinder_pose(spec: Value, a_deg: f64, machine_u_mm: f64) -> napi::Result<Pose> {
    let spec: CylinderSpec = from_value(spec, "cylinder")?;
    let p = CylinderTransform::new(spec).pose(a_deg, machine_u_mm);
    Ok(Pose { rotation_x_rad: p.rotation_x_rad, translation_x_mm: p.translation_x_mm })
}

// ---------------------------------------------------------------- import / project files

#[napi]
pub fn import_svg(svg: String) -> napi::Result<Value> {
    to_value(&laser_project::import_svg(&svg).map_err(err)?)
}

#[napi]
pub fn text_to_path(text: String, font_size_mm: f64, font_family: String) -> napi::Result<Value> {
    to_value(&laser_project::text_to_path(&text, font_size_mm, &font_family).map_err(err)?)
}

/// CAD source file stored in the `.ols` container.
#[napi(object)]
pub struct OlsCadFile {
    pub path: String,
    pub sha256: String,
    pub data: Buffer,
}

#[napi]
pub fn save_ols(project: Value, thumbnail_png: Option<Buffer>, cad_files: Vec<OlsCadFile>) -> napi::Result<Buffer> {
    let p: Project = from_value(project, "project")?;
    let files: Vec<laser_project::CadFile> =
        cad_files.into_iter().map(|f| laser_project::CadFile { path: f.path, sha256: f.sha256, data: f.data.to_vec() }).collect();
    let bytes = laser_project::save_ols(&p, thumbnail_png.as_deref(), &files).map_err(err)?;
    Ok(bytes.into())
}

#[napi(object)]
pub struct LoadedProject {
    pub project: Value,
    pub thumbnail_png: Option<Buffer>,
    pub cad_files: Vec<OlsCadFile>,
    pub warnings: Vec<String>,
}

#[napi]
pub fn load_ols(data: Buffer) -> napi::Result<LoadedProject> {
    let loaded = laser_project::load_ols(&data).map_err(err)?;
    Ok(LoadedProject {
        project: to_value(&loaded.project)?,
        thumbnail_png: loaded.thumbnail_png.map(Into::into),
        cad_files: loaded.cad_files.into_iter().map(|f| OlsCadFile { path: f.path, sha256: f.sha256, data: f.data.into() }).collect(),
        warnings: loaded.warnings,
    })
}

#[napi]
pub fn analyze_gcode(text: String, dialect: String) -> napi::Result<Value> {
    let d = match dialect.as_str() {
        "xtool-f1" => laser_gcode::Dialect::XTOOL_F1,
        "generic" => laser_gcode::Dialect::GENERIC,
        other => return Err(invalid(format!("unknown dialect '{other}'"))),
    };
    let blocks = laser_gcode::parse(&text);
    let analysis = laser_gcode::analyze(&blocks, &d, 3000.0 * 60.0);
    let diagnostics = laser_gcode::validate(&blocks, &d);
    to_value(&serde_json::json!({ "analysis": analysis, "diagnostics": diagnostics }))
}

// ---------------------------------------------------------------- planning (async)

fn summary(tp: &Toolpath) -> serde_json::Value {
    serde_json::json!({
        "mode": tp.mode,
        "strategy": tp.strategy,
        "stats": tp.stats,
        "sections": tp.sections,
        "warnings": tp.warnings,
        "errors": tp.errors,
        "simulationOnly": tp.simulation_only,
        "executable": tp.is_executable(),
    })
}

pub struct PlanOutput {
    summary: Value,
    mark: Vec<f32>,
    travel: Vec<f32>,
    offsets: Vec<u32>,
    segments_2d: Vec<f32>,
    listing: Vec<String>,
    programs: Vec<Vec<String>>,
    gcode_supported: bool,
}

#[napi(object)]
pub struct PlanResult {
    pub summary: Value,
    /// Mark line pieces in the 3D preview frame (xyz pairs).
    pub mark_positions: Float32Array,
    pub travel_positions: Float32Array,
    /// Mark vertex count before each segment (length segmentCount + 1).
    pub mark_vertex_offsets: Uint32Array,
    /// Per segment `[x0, y0, x1, y1, kind]` in design coordinates (surface u/s in cylinder
    /// mode, galvo field in flat mode). kind: 0 travel, 1 mark, 2 barrier.
    pub segments_2d: Float32Array,
    pub gcode_listing: Vec<String>,
    pub gcode_programs: Vec<Vec<String>>,
    pub gcode_supported: bool,
}

pub struct PlanTask {
    project: Option<Project>,
}

fn run_plan(project: &Project) -> PlanOutput {
    let tp = plan(project);
    let overlay = build_overlay(&tp, project);
    let prog = emit_f1(&tp, project.machine.galvo.max_travel_speed_mm_s);
    let mut segments_2d = Vec::with_capacity(tp.segments.len() * 5);
    for s in &tp.segments {
        let kind = match s.kind {
            SegmentKind::Mark if s.laser_on => 1.0,
            SegmentKind::Barrier => 2.0,
            _ => 0.0,
        };
        let [x0, y0, x1, y1] = s.surface.unwrap_or([s.start.gx_mm, s.start.gy_mm, s.end.gx_mm, s.end.gy_mm]);
        segments_2d.extend([x0 as f32, y0 as f32, x1 as f32, y1 as f32, kind]);
    }
    PlanOutput {
        summary: summary(&tp),
        mark: overlay.mark_positions,
        travel: overlay.travel_positions,
        offsets: overlay.mark_vertex_offsets,
        segments_2d,
        listing: prog.listing,
        programs: prog.sections,
        gcode_supported: prog.supported,
    }
}

impl Task for PlanTask {
    type Output = PlanOutput;
    type JsValue = PlanResult;

    fn compute(&mut self) -> napi::Result<PlanOutput> {
        let p = self.project.take().ok_or_else(|| invalid("task already consumed"))?;
        Ok(run_plan(&p))
    }

    fn resolve(&mut self, _env: Env, o: PlanOutput) -> napi::Result<PlanResult> {
        Ok(PlanResult {
            summary: o.summary,
            mark_positions: Float32Array::new(o.mark),
            travel_positions: Float32Array::new(o.travel),
            mark_vertex_offsets: Uint32Array::new(o.offsets),
            segments_2d: Float32Array::new(o.segments_2d),
            gcode_listing: o.listing,
            gcode_programs: o.programs,
            gcode_supported: o.gcode_supported,
        })
    }
}

#[napi(ts_return_type = "Promise<PlanResult>")]
pub fn plan_toolpath(project: Value, signal: Option<AbortSignal>) -> napi::Result<AsyncTask<PlanTask>> {
    let p: Project = from_value(project, "project")?;
    Ok(AsyncTask::with_optional_signal(PlanTask { project: Some(p) }, signal))
}

#[napi(object)]
pub struct TimelineBuffers {
    pub t: Float64Array,
    pub gx: Float64Array,
    pub gy: Float64Array,
    pub a: Float64Array,
    pub u: Float64Array,
    pub laser: Float64Array,
    pub power: Float64Array,
    pub state: Float64Array,
    pub section: Float64Array,
    pub segment: Float64Array,
    pub rot_x: Float64Array,
    pub tx: Float64Array,
    pub spot_x: Float64Array,
    pub spot_y: Float64Array,
    pub spot_z: Float64Array,
    pub events: Value,
    pub duration_s: f64,
}

fn timeline_buffers(e: TimelineExport) -> napi::Result<TimelineBuffers> {
    Ok(TimelineBuffers {
        events: to_value(&e.events)?,
        duration_s: e.duration_s,
        t: Float64Array::new(e.t),
        gx: Float64Array::new(e.gx),
        gy: Float64Array::new(e.gy),
        a: Float64Array::new(e.a),
        u: Float64Array::new(e.u),
        laser: Float64Array::new(e.laser),
        power: Float64Array::new(e.power),
        state: Float64Array::new(e.state),
        section: Float64Array::new(e.section),
        segment: Float64Array::new(e.segment),
        rot_x: Float64Array::new(e.rot_x),
        tx: Float64Array::new(e.tx),
        spot_x: Float64Array::new(e.spot_x),
        spot_y: Float64Array::new(e.spot_y),
        spot_z: Float64Array::new(e.spot_z),
    })
}

pub struct KinematicTask {
    project: Option<Project>,
    dt: f64,
}

impl Task for KinematicTask {
    type Output = TimelineExport;
    type JsValue = TimelineBuffers;

    fn compute(&mut self) -> napi::Result<TimelineExport> {
        let p = self.project.take().ok_or_else(|| invalid("task already consumed"))?;
        let tp = plan(&p);
        let tl = kinematic_timeline(&tp, &p.machine, self.dt);
        let g = &p.machine.galvo;
        Ok(tl.export(0, 0, p.mode, &p.workpiece, (g.center_x_mm, g.center_y_mm), (g.invert_x, g.invert_y)))
    }

    fn resolve(&mut self, _env: Env, o: TimelineExport) -> napi::Result<TimelineBuffers> {
        timeline_buffers(o)
    }
}

/// Planner-timed preview timeline (no device model). Works for every strategy.
#[napi(ts_return_type = "Promise<TimelineBuffers>")]
pub fn kinematic_preview(project: Value, sample_dt: f64, signal: Option<AbortSignal>) -> napi::Result<AsyncTask<KinematicTask>> {
    let p: Project = from_value(project, "project")?;
    Ok(AsyncTask::with_optional_signal(KinematicTask { project: Some(p), dt: sample_dt.clamp(0.001, 1.0) }, signal))
}

// ---------------------------------------------------------------- simulated session

#[napi]
pub struct SimSession {
    inner: CoreSession,
}

#[napi]
impl SimSession {
    #[napi(constructor)]
    pub fn new(project: Value, config: Option<Value>) -> napi::Result<Self> {
        let p: Project = from_value(project, "project")?;
        let cfg: SimConfig = match config {
            Some(c) => from_value(c, "sim config")?,
            None => SimConfig::default(),
        };
        Ok(Self { inner: CoreSession::new(p, cfg) })
    }

    #[napi]
    pub fn set_project(&mut self, project: Value) -> napi::Result<()> {
        let p: Project = from_value(project, "project")?;
        self.inner.set_project(p).map_err(err)
    }

    #[napi]
    pub fn connect(&mut self) -> napi::Result<()> {
        self.inner.connect().map_err(err)
    }

    #[napi]
    pub fn disconnect(&mut self) -> napi::Result<()> {
        self.inner.disconnect().map_err(err)
    }

    #[napi]
    pub fn home(&mut self) -> napi::Result<()> {
        self.inner.home().map_err(err)
    }

    #[napi]
    pub fn prepare(&mut self) -> napi::Result<Value> {
        let r = self.inner.prepare().map_err(err)?;
        to_value(&r)
    }

    #[napi]
    pub fn arm(&mut self, user_confirmed: bool) -> napi::Result<()> {
        self.inner.arm(user_confirmed).map_err(err)
    }

    #[napi]
    pub fn disarm(&mut self) -> napi::Result<()> {
        self.inner.disarm().map_err(err)
    }

    #[napi]
    pub fn start(&mut self) -> napi::Result<()> {
        self.inner.start().map_err(err)
    }

    #[napi]
    pub fn pause(&mut self) -> napi::Result<()> {
        self.inner.pause().map_err(err)
    }

    #[napi]
    pub fn resume(&mut self) -> napi::Result<()> {
        self.inner.resume().map_err(err)
    }

    #[napi]
    pub fn stop(&mut self) -> napi::Result<()> {
        self.inner.stop().map_err(err)
    }

    #[napi]
    pub fn emergency_stop(&mut self, source: String) -> napi::Result<()> {
        self.inner.emergency_stop(&source).map_err(err)
    }

    #[napi]
    pub fn reset_fault(&mut self, user_confirmed: bool) -> napi::Result<()> {
        self.inner.reset_fault(user_confirmed).map_err(err)
    }

    #[napi]
    pub fn reset_estop(&mut self, user_confirmed: bool, hardware_released: bool) -> napi::Result<()> {
        self.inner.reset_estop(user_confirmed, hardware_released).map_err(err)
    }

    #[napi]
    pub fn inject(&mut self, injection: Value) -> napi::Result<()> {
        let inj: Injection = from_value(injection, "injection")?;
        self.inner.inject(inj);
        Ok(())
    }

    /// Advance simulated time; returns the session snapshot.
    #[napi]
    pub fn tick(&mut self, dt_s: f64) -> napi::Result<Value> {
        if !dt_s.is_finite() || !(0.0..=10.0).contains(&dt_s) {
            return Err(invalid("dt must be within 0..10 s"));
        }
        to_value(&self.inner.tick(dt_s))
    }

    #[napi]
    pub fn snapshot(&self) -> napi::Result<Value> {
        to_value(&self.inner.snapshot())
    }

    #[napi]
    pub fn timeline(&self, from_sample: u32, from_event: u32) -> napi::Result<TimelineBuffers> {
        timeline_buffers(self.inner.timeline_export(from_sample as usize, from_event as usize))
    }

    #[napi]
    pub fn log_since(&self, seq: f64) -> napi::Result<Value> {
        to_value(&self.inner.log_since(seq.max(0.0) as u64))
    }

    #[napi]
    pub fn job_log(&self) -> napi::Result<Value> {
        to_value(&self.inner.job_log())
    }

    #[napi]
    pub fn safety_history(&self) -> napi::Result<Value> {
        to_value(&self.inner.safety_history())
    }

    #[napi]
    pub fn program_listing(&self) -> Vec<String> {
        self.inner.program().map(|p| p.listing.clone()).unwrap_or_default()
    }
}

// ---------------------------------------------------------------- real device discovery (gated, read-only)

fn gate_real_device(simulation_only: bool, developer_mode: bool) -> napi::Result<()> {
    if simulation_only {
        return Err(err(CoreError::Safety("simulationOnly is enabled".into())));
    }
    if !developer_mode {
        return Err(err(CoreError::Safety("real-device access requires developer mode".into())));
    }
    Ok(())
}

#[napi(object)]
pub struct DiscoverOptions {
    /// `"wifi"` (UDP LAN scan) or `"usb"` (gadget IP probe).
    pub transport: String,
    pub timeout_ms: u32,
    pub simulation_only: bool,
    pub developer_mode: bool,
}

#[napi(object)]
pub struct IdentifyOptions {
    pub host: String,
    pub simulation_only: bool,
    pub developer_mode: bool,
}

#[napi(object)]
#[derive(Clone)]
pub struct JsPortProbe {
    pub http8080: bool,
    pub tcp8780: bool,
    pub tls28900: bool,
}

#[napi(object)]
#[derive(Clone)]
pub struct JsDiscoveredDevice {
    pub host: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub source: String,
    pub family: String,
    pub firmware: Option<String>,
    pub ports: JsPortProbe,
    pub machine_info: Value,
    pub raw: Value,
}

fn family_str(f: laser_protocol::FirmwareFamily) -> String {
    match f {
        laser_protocol::FirmwareFamily::V1 => "v1".into(),
        laser_protocol::FirmwareFamily::V2 => "v2".into(),
        laser_protocol::FirmwareFamily::Unknown => "unknown".into(),
    }
}

fn source_str(s: laser_protocol::DeviceSource) -> String {
    match s {
        laser_protocol::DeviceSource::Usb => "usb".into(),
        laser_protocol::DeviceSource::Wifi => "wifi".into(),
        laser_protocol::DeviceSource::Manual => "manual".into(),
    }
}

fn to_js_device(id: laser_protocol::DeviceIdentity) -> JsDiscoveredDevice {
    JsDiscoveredDevice {
        host: id.host,
        name: id.name,
        model: id.model,
        serial: id.serial,
        source: source_str(id.source),
        family: family_str(id.family),
        firmware: id.firmware,
        ports: JsPortProbe {
            http8080: id.ports.http8080,
            tcp8780: id.ports.tcp8780,
            tls28900: id.ports.tls28900,
        },
        machine_info: id.machine_info,
        raw: id.raw,
    }
}

pub struct DiscoverTask {
    opts: DiscoverOptions,
}

impl Task for DiscoverTask {
    type Output = Vec<JsDiscoveredDevice>;
    type JsValue = Vec<JsDiscoveredDevice>;

    fn compute(&mut self) -> napi::Result<Vec<JsDiscoveredDevice>> {
        gate_real_device(self.opts.simulation_only, self.opts.developer_mode)?;
        let timeout = std::time::Duration::from_millis(u64::from(self.opts.timeout_ms.clamp(250, 5000)));
        let identify_cfg = laser_protocol::IdentifyConfig {
            connect_timeout: std::time::Duration::from_millis(800),
            ..Default::default()
        };
        let devices = match self.opts.transport.as_str() {
            "usb" => laser_protocol::identify_usb(&identify_cfg),
            "wifi" => {
                let discover = laser_protocol::DiscoverConfig {
                    timeout,
                    ..Default::default()
                };
                laser_protocol::discover_and_identify(&discover, &identify_cfg).map_err(err)?
            }
            other => return Err(invalid(format!("unknown transport '{other}' (expected wifi|usb)"))),
        };
        Ok(devices.into_iter().map(to_js_device).collect())
    }

    fn resolve(&mut self, _env: Env, out: Vec<JsDiscoveredDevice>) -> napi::Result<Vec<JsDiscoveredDevice>> {
        Ok(out)
    }
}

/// UDP / USB discovery + read-only identify. Never writes G-code.
#[napi(ts_return_type = "Promise<object[]>")]
pub fn discover_devices(opts: DiscoverOptions, signal: Option<AbortSignal>) -> napi::Result<AsyncTask<DiscoverTask>> {
    Ok(AsyncTask::with_optional_signal(DiscoverTask { opts }, signal))
}

pub struct IdentifyTask {
    opts: IdentifyOptions,
}

impl Task for IdentifyTask {
    type Output = JsDiscoveredDevice;
    type JsValue = JsDiscoveredDevice;

    fn compute(&mut self) -> napi::Result<JsDiscoveredDevice> {
        gate_real_device(self.opts.simulation_only, self.opts.developer_mode)?;
        let host = self.opts.host.trim();
        if host.is_empty() {
            return Err(invalid("host is empty"));
        }
        let mut id = laser_protocol::identify(host, &laser_protocol::IdentifyConfig::default()).map_err(err)?;
        id.source = laser_protocol::DeviceSource::Manual;
        // Preserve USB tagging when the user typed a gadget IP.
        if matches!(laser_protocol::source_for_host(host), laser_protocol::DeviceSource::Usb) {
            id.source = laser_protocol::DeviceSource::Usb;
        }
        Ok(to_js_device(id))
    }

    fn resolve(&mut self, _env: Env, out: JsDiscoveredDevice) -> napi::Result<JsDiscoveredDevice> {
        Ok(out)
    }
}

/// Read-only identify of a single host. Never writes G-code.
#[napi(ts_return_type = "Promise<object>")]
pub fn identify_device(opts: IdentifyOptions, signal: Option<AbortSignal>) -> napi::Result<AsyncTask<IdentifyTask>> {
    Ok(AsyncTask::with_optional_signal(IdentifyTask { opts }, signal))
}
