# PROJECT: Open Laser Studio — Open-Source Laser Design and Motion-Control Software for xTool F1

## ROLE AND OPERATING INSTRUCTIONS

You are acting as a senior software architect, embedded systems engineer, motion-control engineer, reverse-engineering specialist, CAD/CAM developer, and desktop UI engineer.

Your task is to design and progressively implement a production-quality, open-source laser engraving application initially targeting the **original xTool F1**, with a modular architecture for future support of additional laser engravers and custom external motion controllers.

Do not produce only a specification, conceptual prototype, or collection of disconnected code samples.

Build an actual, executable software project, incrementally, with working features, tests, documentation, simulator support, and a polished desktop interface.

You have permission to research public documentation and open-source repositories, create and modify local project files, run development commands, install dependencies, execute tests, and perform non-destructive development operations.

You do NOT have permission to assume that real laser hardware is connected, start real laser emission, bypass physical interlocks, flash firmware to connected hardware, or send untested machine-control commands.

Never claim that a device feature is working unless it has been validated against that device or a clearly identified simulation.

Whenever you encounter incomplete information, investigate it, record the uncertainty, implement an appropriate abstraction, and continue developing functionality that does not depend on that uncertainty.

Work autonomously. Make reasonable technical decisions without repeatedly asking for approval.

---

# 1. PRODUCT VISION

Develop an application provisionally called **Open Laser Studio**.

It should eventually provide capabilities similar to xTool Studio and LightBurn, with significantly greater flexibility for custom hardware, additional motion axes, and experimental laser processing workflows.

The project starts with the xTool F1, a desktop galvanometer-based laser engraver featuring two laser sources:

- Blue diode laser
- Infrared laser

The long-term objective is to control:

1. Galvanometer X-axis
2. Galvanometer Y-axis
3. External rotary A-axis
4. External linear U-axis

The external A and U axes will be part of a custom rotary-linear mechanism intended to engrave long cylindrical objects.

A key differentiator is the ability to engrave arbitrary artwork onto a cylindrical workpiece while coordinating rotation and axial translation.

Examples include:

- Continuous engraving along a long metal tube
- Engraving designs around multiple cylinder revolutions
- Helical text and patterns
- Continuous spiral marking
- Long cylindrical raster engraving
- Wrapped vector graphics
- Repeated markings with precise axial indexing
- Full-surface engraving beyond the F1's normal marking field

However, synchronized laser emission, galvanometer movement, and external mechanics must be demonstrated experimentally. Do not assume the existing F1 protocol provides deterministic real-time synchronization.

Implement useful intermediate capabilities even when full synchronization is unavailable.

---

# 2. INITIAL RESEARCH — MANDATORY

Before implementing the hardware communication layer, inspect these sources.

## 2.1 BeamInk — Highest priority

Repository:

https://github.com/sfn-tools/BeamInk

This project demonstrates direct control of the xTool F1 using Python.

Investigate:

- `beamink/transport/xtool.py`
- `beamink/transport/base.py`
- `beamink/transport/sim.py`
- `beamink/core/controller.py`
- `beamink/core/mapping.py`
- `beamink/config.py`
- The application lifecycle and device-safety handling

BeamInk documents G-code transport over TCP port 8780 and HTTP endpoints for machine information and processing stop.

It has been used with an F1 presented to Linux as a USB Ethernet interface.

Research the actual implementation to determine:

- How transport connections are established
- Whether streaming requires initialization or preparation
- How G-code messages are framed
- How responses are parsed
- How commands are acknowledged
- How machine status is determined
- How laser-source selection works
- How laser power is represented
- How session startup and shutdown work
- Whether data is streamed continuously or buffered
- Whether there is an explicit job-completion signal
- How errors and disconnections are handled

Do not blindly copy BeamInk code or assume that its tested connection works unchanged on every F1 firmware version.

Review its license, preserve any required notices, and attribute reused code correctly.

Prefer an independently structured implementation using verified protocol behavior, unless actual code reuse is beneficial and compatible with licensing.

## 2.2 LightBurn TCP interception experiment

Read:

https://forum.lightburnsoftware.com/t/connection-to-custom-linear-axis-via-tcp-interception-is-possible/163546

The author reports:

- Intercepting LightBurn-to-F1 TCP communication through a Python proxy
- Forwarding selected G-code commands to an Arduino
- Driving an external linear stepper mechanism
- Using an Arduino-side simplified G-code interpreter
- Encountering limitations around coordinating external motion with F1 command execution

Study this as proof of concept for a protocol proxy.

Crucially, do not interpret the experiment as proof of simultaneous multi-axis synchronization.

Evaluate whether the proxy architecture can be expanded with:

- Separate command queues
- Execution barriers
- Actual machine-state feedback
- Command correlation
- Buffered command scheduling
- Explicit external-motion completion acknowledgments
- Conservative synchronization strategies

Document what is known, what is inferred, and what remains unverified.

## 2.3 Official xTool F1 LightBurn instructions

Read:

https://support.xtool.com/article/1263

Also:

https://support.xtool.com/article/496

Investigate the documented sequence:

```gcode
G100
M116A2B-4
```

And rotary-mode exit:

```gcode
G101
```

The documented `M116AaBb` mechanism substitutes axes, with identifiers corresponding to X, Y, Z, and U.

Study:

- Rotary setup behavior
- Axis substitution semantics
- G-code modes
- Framing commands
- Rotary calibration parameters
- The use of buffered transfer mode
- Laser-source selection
- Processing setup
- Device command lifecycle

The documentation does not prove that multiple additional axes can operate simultaneously.

Create explicit experiments to determine what the existing F1 controller can do.

Treat any unsupported command combinations as experimental.

## 2.4 Other open-source projects

Inspect:

https://github.com/thecodingdad/ha-xtool

https://github.com/1RandomDev/xTool-Connect

https://github.com/1RandomDev/xTool-Connect/blob/master/XTOOL_PROTOCOL.md

https://github.com/meerk40t/galvoplotter

The projects use different xTool and galvanometer protocol families.

Avoid incorrectly transferring D1 Pro commands to the F1.

Look for reusable concepts:

- Connection discovery
- Request/response correlation
- Machine status handling
- Job progress tracking
- Transport abstractions
- Network protocol debugging
- G-code parsing
- Command scheduling
- Error recovery

Investigate MeerK40t and galvoplotter only as architectural references for galvo-based laser control, not as proven F1 backends.

## 2.5 Research deliverables

Create:

`docs/research/REFERENCE_PROJECTS.md`

`docs/research/F1_PROTOCOL.md`

`docs/research/PROTOCOL_EVIDENCE.md`

`docs/research/OPEN_QUESTIONS.md`

Every significant protocol finding must indicate:

- Source
- Exact command or response
- Tested device model
- Known firmware version, if available
- Confidence level: VERIFIED, DOCUMENTED, INFERRED, or UNKNOWN
- Steps necessary to validate it

Do not mix verified device behavior with assumptions.

---

# 3. REQUIRED TECHNOLOGY STACK — ELECTRON + REACT + THREE.JS

## 3.1 Core architecture

Build Open Laser Studio as a native desktop application based on the following technologies.

| Layer | Technology |
|---|---|
| Desktop runtime | Electron |
| Frontend | React + TypeScript |
| Build tooling | Vite + electron-vite |
| 3D rendering | Three.js |
| React 3D integration | React Three Fiber |
| 3D utilities | @react-three/drei |
| State management | Zustand |
| Server/async state | TanStack Query, where appropriate |
| UI components | shadcn/ui + Radix UI |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| 2D editor | Konva + react-konva |
| Vector geometry | Rust core, with SVG interoperability |
| Native backend | Rust |
| Rust/Node integration | N-API-RS |
| Embedded controller | ESP32-S3 + ESP-IDF |
| Desktop packaging | Electron Builder |

Target Windows 10/11 first, followed by Linux and macOS.

Use strict TypeScript, modular packages, automated tests, and reproducible builds.

Avoid unnecessary runtime dependencies.

Verify current library compatibility and maintenance status before installing packages.

---

## 3.2 Electron process architecture

Use Electron's recommended multi-process architecture.

```text
┌──────────────────────────────────────────┐
│             ELECTRON APP                 │
│                                          │
│  Renderer Process                        │
│  ┌────────────────────────────────────┐  │
│  │ React + TypeScript                 │  │
│  │                                    │  │
│  │ 2D Editor — Konva                  │  │
│  │ 3D Preview — Three.js / R3F        │  │
│  │ UI — shadcn/ui                      │  │
│  │ State — Zustand                    │  │
│  └────────────────────────────────────┘  │
│                  │                       │
│              Typed IPC                   │
│                  │                       │
│  ┌────────────────────────────────────┐  │
│  │ Electron Main Process              │  │
│  │                                    │  │
│  │ Native Rust Core — N-API-RS        │  │
│  │ Device connections                 │  │
│  │ Job management                     │  │
│  │ Hardware communication             │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
                   │
          Hardware interfaces
                   │
       ┌───────────┴───────────┐
       │                       │
    xTool F1             ESP32-S3
    Galvos               Rotary A
    Lasers               Linear U
```

The React renderer must never directly access Node.js hardware APIs, TCP sockets, serial ports, or native machine-control functions.

Use a restricted Electron preload bridge with explicit, typed methods.

Security requirements:

- `contextIsolation: true`
- `nodeIntegration: false`
- Sandbox renderer processes where feasible
- Strict Content Security Policy
- Validate every IPC payload
- Restrict navigation and external URLs
- Avoid exposing generic command execution
- Keep device credentials and settings outside the renderer

Use Electron IPC for communication between frontend and backend.

Use N-API-RS to expose a carefully defined native Rust API to the Electron main process.

Never expose arbitrary native functions through the preload bridge.

For long-running machine operations, use asynchronous native functions or worker processes so the Electron event loop remains responsive.

---

## 3.3 Frontend architecture

Use React with functional components and TypeScript.

Organize the frontend around independent features.

Major features:

- Project management
- 2D design editor
- 3D cylindrical preview
- Machine configuration
- Device connection
- Engraving parameters
- Toolpath generation
- Motion simulation
- Job execution
- Hardware calibration
- Protocol diagnostics
- Application settings

Use Zustand for frontend application state.

Maintain separate state slices for:

- Active project
- Document objects
- Selection
- Editor tools
- Viewport
- Layers
- Machine configuration
- Cylinder configuration
- Generated toolpaths
- Simulation playback
- Connection state
- Job execution state

Avoid storing rapidly changing animation-frame values in global React state.

High-frequency motion simulation should use an external timeline and update Three.js objects directly through frame callbacks or appropriate optimized stores.

Implement undo/redo using explicit document commands or reversible mutations.

Do not couple domain geometry to Konva or Three.js object instances.

---

## 3.4 2D design editor

Use **Konva + react-konva** for the main vector-design workspace.

Support:

- Pan and zoom
- Selection
- Multi-selection
- Dragging
- Resize handles
- Rotation handles
- Rectangle and ellipse tools
- Lines and paths
- Text objects
- Image import
- Layer organization
- Grid and rulers
- Snapping
- Alignment guides
- Object grouping
- Precision transforms
- Keyboard shortcuts

Use SVG as an important import/export format.

Do not use the Konva scene graph as the authoritative project data model.

Instead, maintain an independent scene/document model containing:

- Object geometry
- Transform matrices
- Layers
- Laser processing settings
- Object metadata
- Visibility
- Locking
- Artwork references

Konva should render and manipulate this model through controlled adapters.

Implement accurate conversion between screen, canvas, design and machine coordinates.

Develop geometry tests independently of the UI.

Use the Rust geometry engine for complex vector operations and toolpath generation.

---

## 3.5 Three.js cylindrical workspace

Implement an interactive 3D cylindrical engraving preview using:

- Three.js
- React Three Fiber
- @react-three/drei

The 3D workspace is a central feature of Open Laser Studio, not a decorative preview.

It must support:

### Workpiece geometry

- Configurable cylinder diameter
- Configurable cylinder length
- Dynamic cylinder mesh
- Orientation along the machine's axial direction
- Adjustable cylinder positioning
- Configurable surface origin
- Visible engraving boundaries
- Angular zero reference
- Axial zero reference

### Artwork visualization

- Real-time artwork wrapping
- Accurate cylindrical UV mapping
- Texture generation from the design document
- Multi-revolution artwork
- Seam placement
- Surface-position highlighting
- Vector and raster artwork visualization
- Material appearance presets
- Engraved-region visualization

Use the same underlying cylindrical coordinate transformations as the motion planner.

Do not implement separate, inconsistent mathematical transformations in the 2D and 3D systems.

### Camera controls

- Orbit
- Pan
- Zoom
- Front view
- Side view
- Top view
- Isometric view
- Fit object
- Reset camera

Use OrbitControls through drei.

### Motion visualization

Animate:

- Cylinder rotation
- Axial translation
- Rotary chuck movement
- Linear carriage movement
- Galvo beam intersection, when modeled
- Simulated laser marking position
- Toolpath execution
- Engraving progress

Use a common simulation clock shared between the motion engine and 3D renderer.

The 3D visualization must reflect generated motion data, rather than inventing independent animation trajectories.

### Performance

Implement:

- Efficient mesh updates
- Texture caching
- Geometry reuse
- Adaptive tessellation
- Viewport resize handling
- Controlled rendering frequency
- Disposal of unused GPU resources

For heavy scene processing, consider Web Workers.

Avoid rendering the entire artwork into a new high-resolution texture on every React state change.

---

## 3.6 Optional full machine visualization

Design the 3D architecture so we can later add an approximate digital twin of the complete engraving system.

Potential objects include:

- F1 machine body
- Laser marking field
- Rotary chuck
- Motor
- Linear rail
- Leadscrew
- Workpiece supports
- External rotary-linear attachment
- Workpiece
- Motion axes

The visualization must be driven by machine geometry and actual motion state.

Use a hierarchical scene graph.

For example:

```text
MachineScene
├── LaserMachine
│   └── GalvoWorkspace
├── LinearStage
│   └── MovingCarriage
│       ├── RotaryMotor
│       ├── Chuck
│       └── Cylinder
├── CoordinateAxes
├── Toolpath
└── LaserIntersection
```

The scene must support both a simplified visualization and a more detailed hardware model.

Do not block initial development on obtaining accurate 3D CAD models of the F1.

---

## 3.7 Shared geometry and motion state

The most important architectural requirement is maintaining a **single authoritative geometry and motion representation**.

The project must not have independent coordinate systems implemented differently in React, Three.js, Konva and Rust.

Rust owns:

- Machine coordinate transforms
- Cylinder surface transforms
- Toolpath generation
- Rotary/linear motion planning
- Bounds checking
- Motion interpolation
- Simulation state generation

The frontend consumes structured geometry and simulation data.

Use a consistent coordinate convention.

For example:

- Gx: galvo X
- Gy: galvo Y
- A: cylinder rotation
- U: axial translation

And surface coordinates:

- s: circumferential position
- u: axial position

Define units explicitly.

Implement documented conversions between these coordinate spaces.

Provide fixtures and automated tests ensuring that:

1. A point selected in the 2D cylindrical editor maps correctly onto the 3D cylinder.
2. The motion planner generates the corresponding angular and axial position.
3. The simulation reproduces the planned position.
4. The visualization and hardware command data remain consistent.

---

## 3.8 Rust native core

Retain Rust as the hardware and motion-control backend.

Use Rust crates for:

- F1 communication protocol
- TCP transport
- G-code parsing
- Vector geometry
- Cylindrical transformations
- Toolpath generation
- Motion planning
- Multi-axis coordination
- Job execution
- Safety-state management
- Machine simulation
- Project serialization

Use **N-API-RS** to expose selected functions to Electron.

Design a versioned interface between TypeScript and Rust.

Prefer:

- Explicit types
- Structured errors
- Asynchronous native operations
- Binary data buffers where advantageous
- Cancellation support
- Deterministic simulation interfaces

Avoid repeatedly transferring enormous toolpath arrays through JSON IPC.

Use binary buffers or shared data representations where they provide a measurable advantage, while preserving process isolation.

Keep the Rust core independently executable and testable without Electron.

---

## 3.9 ESP32-S3 firmware

Retain the embedded controller architecture:

- ESP32-S3
- ESP-IDF
- Two TMC2209 stepper drivers
- Rotary A axis
- Linear U axis
- Linear homing switch
- Optional encoders
- Hardware safety inputs
- USB serial communications

The ESP32 communicates with the Rust backend.

The Electron renderer does not communicate directly with the embedded controller.

The motion controller must expose reliable movement-state and completion reporting.

---

## 3.10 Updated repository structure

```text
open-laser-studio/
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main/
│       │   ├── preload/
│       │   └── ipc/
│       │
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── editor-2d/
│       │   │   ├── cylinder-3d/
│       │   │   ├── machines/
│       │   │   ├── jobs/
│       │   │   ├── toolpaths/
│       │   │   ├── simulation/
│       │   │   ├── calibration/
│       │   │   └── diagnostics/
│       │   ├── stores/
│       │   ├── hooks/
│       │   ├── services/
│       │   ├── types/
│       │   └── styles/
│       │
│       ├── tests/
│       └── package.json
│
├── packages/
│   ├── shared-types/
│   ├── geometry-adapters/
│   ├── ui/
│   └── ipc-contracts/
│
├── crates/
│   ├── laser-core/
│   ├── laser-geometry/
│   ├── laser-gcode/
│   ├── laser-motion/
│   ├── laser-protocol/
│   ├── laser-devices/
│   ├── laser-simulator/
│   ├── laser-project/
│   └── laser-node/
│
├── firmware/
│   └── esp32-motion-controller/
│
├── tools/
│   ├── protocol-inspector/
│   ├── gcode-analyzer/
│   └── simulator-cli/
│
├── tests/
├── docs/
├── examples/
├── scripts/
├── README.md
└── LICENSE
```

Use pnpm workspaces for JavaScript/TypeScript packages and a Cargo workspace for Rust crates.

---

## 3.11 Updated initial milestone

The first development milestone must produce an executable Electron application.

It must include:

1. A functional Electron desktop window.
2. React + TypeScript frontend.
3. Professional CAD/CAM-style dark UI.
4. Resizable editor panels.
5. A working Konva 2D editor.
6. Basic vector tools and object selection.
7. SVG import.
8. Zustand document state.
9. A Rust core connected using N-API-RS.
10. A simulated F1 device.
11. Basic toolpath generation.
12. A Three.js/R3F cylindrical preview.
13. Real-time wrapping of basic artwork onto a cylinder.
14. Configurable cylinder diameter and length.
15. Manual cylinder rotation and camera controls.
16. Simulated rotary A-axis and linear U-axis movement.
17. A timeline showing simulated toolpath progress.
18. Unit and integration tests.
19. A reproducible development build.

The initial application must demonstrate the complete conceptual workflow:

**Draw in 2D → Wrap onto 3D cylinder → Generate toolpath → Simulate rotary and linear motion.**

All functionality must work without physical hardware.

Real F1 laser-emission commands remain disabled until experimentally validated.

---

## 3.12 Technology exclusions

Do not use:

- Flutter
- Dart
- Tauri
- React Native
- Python as the required application runtime
- Browser-only application architecture
- WebViews inside another desktop shell

Use Electron, React, TypeScript, Konva, Three.js, React Three Fiber and Rust.

All other sections of the original master specification remain in force, interpreted through this revised technology architecture.

**Start implementing the Electron application immediately. Do not stop after producing an architecture document.**

---

# 4. REPOSITORY ARCHITECTURE

Create a monorepo similar to:

```text
open-laser-studio/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── components/
│       │   ├── editor/
│       │   ├── panels/
│       │   ├── dialogs/
│       │   ├── hooks/
│       │   ├── stores/
│       │   ├── services/
│       │   └── types/
│       ├── src-tauri/
│       └── package.json
│
├── crates/
│   ├── laser-core/
│   ├── laser-geometry/
│   ├── laser-gcode/
│   ├── laser-motion/
│   ├── laser-protocol/
│   ├── laser-devices/
│   ├── laser-simulator/
│   └── laser-project/
│
├── firmware/
│   └── esp32-motion-controller/
│       ├── main/
│       ├── components/
│       ├── test/
│       └── sdkconfig.defaults
│
├── tools/
│   ├── protocol-inspector/
│   ├── gcode-analyzer/
│   └── simulator-cli/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   ├── geometry/
│   └── protocol/
│
├── docs/
│   ├── architecture/
│   ├── research/
│   ├── protocols/
│   ├── hardware/
│   ├── development/
│   └── user-guide/
│
├── examples/
├── scripts/
├── README.md
└── LICENSE
```

Adapt the exact layout where useful, but preserve clear boundaries between UI, transport, motion planning, geometry, simulation and embedded firmware.

The UI must never directly emit machine commands.

All real machine operations must pass through the backend safety and device-management layers.

---

# 5. DESKTOP INTERFACE

Implement a real laser design studio.

## 5.1 General layout

Use a workspace with:

**Top toolbar**

- New project
- Open
- Save
- Undo
- Redo
- Selection tool
- Rectangle
- Ellipse
- Line
- Pen/path
- Text
- Image import
- Zoom controls
- Device connection
- Preview
- Frame
- Start
- Pause
- Stop

**Left panel**

- Object tree
- Layers
- Visibility
- Locking
- Object ordering
- Grouping

**Center**

- Main engraving canvas
- Rulers
- Grid
- Origin
- Working area
- Object transforms
- Selection handles
- Zoom and pan
- Snap-to-grid
- Alignment guides

**Right panel**

- Object properties
- Position
- Size
- Rotation
- Laser layer parameters
- Engraving speed
- Power
- Passes
- Fill settings
- Image processing settings

**Bottom panel**

- Machine status
- Console
- G-code preview
- Job queue
- Device connection log
- Protocol inspector
- Progress and error messages

Use resizable panels and persist layout preferences.

## 5.2 Editing engine

Use a properly maintained SVG/vector rendering system.

Evaluate libraries such as Paper.js, Konva, or Fabric.js, but do not choose one without checking their suitability for:

- Vector path editing
- Large designs
- Accurate transforms
- SVG import
- Boolean operations
- Layering
- Hit testing
- Selection
- Editable text
- High-DPI rendering
- Undo/redo history

Keep the project's internal geometry independent of the UI rendering library.

The editor should eventually support:

- SVG
- PNG
- JPEG
- BMP
- DXF, later
- Text to outlines
- Basic path operations
- Object alignment
- Object distribution
- Grouping
- Mirroring
- Rotation
- Scaling
- Copy/paste
- Keyboard shortcuts

Implement SVG and common image formats first.

Do not attempt every advanced editor feature in the initial milestone.

## 5.3 Laser processing

Support two fundamentally different processing strategies.

### Vector engraving

- Path ordering
- Travel optimization
- Laser-on and laser-off segments
- Feed-rate configuration
- Power configuration
- Multiple passes
- Closed-path processing
- Fill and outline modes

### Raster engraving

- Image grayscale conversion
- Thresholding
- Dithering
- Scanline generation
- Horizontal and vertical scanning
- Bidirectional scanning
- Overscan handling
- Pixel-to-motion mapping

Raster processing must eventually account for variable laser intensity and galvo timing.

Do not assume the F1's exact power or feed-rate semantics until verified.

---

# 6. MACHINE AND HARDWARE ABSTRACTION

Define a generic machine interface supporting:

```text
connect()
disconnect()
getCapabilities()
getMachineInfo()
getStatus()
prepareJob()
uploadJob()
executeJob()
pause()
resume()
stop()
emergencyStop()
homeAxis()
moveAxis()
setLaserSource()
getDiagnostics()
```

These are conceptual API operations, not confirmed xTool protocol commands.

Implement capability discovery so a device can advertise features such as:

- Galvo X/Y
- Rotary axis
- Linear axis
- Multiple laser sources
- Framing
- Laser power modulation
- Buffered jobs
- Live command streaming
- Job progress reporting
- Position feedback
- Homing
- Pause/resume
- Emergency stop
- External-axis synchronization

Unavailable capabilities must be explicitly disabled or marked experimental in the interface.

Initially implement:

1. SimulatorDevice
2. XToolF1Device
3. ExternalMotionControllerDevice
4. CompositeMachineDevice

The composite machine represents a complete manufacturing system consisting of the original F1 plus the external axis controller.

---

# 7. XTOOL F1 PROTOCOL IMPLEMENTATION

Build a dedicated transport module rather than embedding TCP logic throughout the application.

Research and implement the verified F1 communication protocol.

Start with the connection method demonstrated by BeamInk.

Do not assume that all xTool devices use identical API endpoints.

Important requirements:

- Connection timeout
- Reconnection policy
- Command queue
- Response parser
- Device-state tracking
- Explicit disconnect handling
- Firmware identification where available
- Command recording
- Optional raw protocol log
- Simulation backend
- Safety-state integration

Provide two modes.

## Mode 1: Direct F1 connection

The application communicates with the F1 without xTool Studio or LightBurn.

## Mode 2: Passive/experimental proxy

A diagnostic proxy captures and forwards a third-party application's existing F1 traffic.

Initially this mode must be transparent and non-destructive.

Support:

- Timestamped messages
- Direction of communication
- Raw payloads
- Parsed commands
- Response correlation
- Transport timing
- Exportable captures
- Replay into a simulator

Do not inject, modify, or suppress commands in the initial proxy implementation.

Ensure captured traffic is sanitized before sharing.

---

# 8. MOTION MODEL: FOUR COORDINATES

Implement a coordinate system that separates the laser's local marking coordinates from the workpiece's mechanical positioning.

Use:

- Gx: local galvanometer X position
- Gy: local galvanometer Y position
- A: workpiece rotation in radians or degrees
- U: axial translation in millimeters

Use canonical units internally.

Represent the workpiece surface in unwrapped coordinates:

- s: circumferential surface distance
- u: axial distance

For a perfect cylinder:

```text
s = R * theta
```

Where:

- R is cylinder radius
- theta is angular displacement in radians

Equivalently:

```text
s = PI * D * A / 360
```

Where A is in degrees.

For helical movement:

```text
U = U0 + P * A / 360
```

Where P is pitch in millimeters per revolution.

This model must support:

- Positive and negative rotation
- Absolute and relative positioning
- Configurable machine orientation
- Configurable cylinder diameter
- Angular zero position
- Axial zero position
- Coordinate transformations
- Work offsets
- Repeatable tool paths
- Homing offsets

The geometry engine must remain entirely independent of hardware.

---

# 9. CYLINDRICAL ENGRAVING WORKSPACE

Create a dedicated Cylindrical Mode.

The main canvas shows the cylinder's unwrapped surface.

The horizontal coordinate represents axial position.

The vertical coordinate represents circumferential distance.

For diameter D:

```text
Circumference = PI * D
```

An artwork rectangle measuring 200 mm by 94.25 mm should approximately wrap once around a cylinder with a diameter of 30 mm.

Provide:

- Cylinder diameter input
- Cylinder length input
- Axial engraving range
- Angular range
- Surface origin
- Seam position
- Artwork wrapping
- Multi-revolution patterns
- Helical pitch
- Angular rotation preview
- Axial position preview
- 3D cylinder visualization

The 3D preview must represent the same coordinate system as the motion planner.

Use Three.js if appropriate for the 3D preview, without making the physics or machine geometry depend on Three.js.

The user should be able to draw artwork on a flat canvas and immediately inspect how it appears on the cylindrical surface.

---

# 10. CYLINDRICAL ENGRAVING STRATEGIES

Implement three separate execution strategies.

## Strategy A: Indexed engraving

This is the first practical implementation target.

The process is:

1. Position cylinder
2. Wait for external motion completion
3. Engrave a local section
4. Confirm F1 processing completion
5. Move to the next section
6. Repeat

Support:

- Tile generation
- Section overlap
- Registration
- Axial indexing
- Optional angular indexing
- Job state persistence
- Recovery after interruption

This strategy must not move the workpiece during laser emission.

Do not merely rely on a command-received acknowledgment as proof of execution completion.

Implement explicit completion detection and timeouts.

Where an acknowledgment cannot be trusted, the job must stop safely rather than make an unsafe assumption.

## Strategy B: Electronic gearing / helical mode

Support coupled motion where:

```text
U = U0 + P * A / 360
```

Provide:

- Configurable pitch
- Continuous rotation
- Bidirectional motion
- Encoder feedback
- Configurable acceleration
- Electronic gear ratio
- Motion preview
- Error detection

Initially implement and validate this mode entirely in simulation.

The F1 may remain responsible for rotational movement, with our external motion controller following its motion commands, or both axes may be controlled externally.

Analyze both options.

Do not equate correlated command arrival times with physical synchronization.

A production implementation requires a defined timing model and experimental measurement of tracking error.

Do not permit laser-enabled helical engraving until the relationship between physical motion and laser emission has been validated.

## Strategy C: Fully coordinated engraving

This is the long-term research objective.

The planner must potentially coordinate:

- Galvo X
- Galvo Y
- Rotary A
- Linear U
- Laser firing
- Laser power
- Motion acceleration
- Job timing

The execution engine must account for:

- F1 command buffering
- Galvo motion timing
- External stepper timing
- Communication latency
- Jitter
- Motion completion
- Laser firing latency
- Synchronization barriers
- Tracking error

Investigate whether deterministic synchronization is exposed by the F1.

If not, explore alternatives such as:

- Segmented engraving
- Stop-and-go processing
- Carefully bounded local-field compensation
- Hardware synchronization, if independently verified
- Alternative device interfaces

Do not fabricate synchronization support or prematurely implement a command scheduler that assumes hard real-time guarantees over ordinary TCP.

If full arbitrary continuous engraving cannot be supported, document the precise blocking limitation and retain indexed engraving as a useful production feature.

---

# 11. MOTION PLANNER

Design a reusable motion-planning subsystem.

Inputs:

- Vector artwork
- Raster artwork
- Machine geometry
- Workpiece geometry
- Tool configuration
- Motion constraints
- Laser processing parameters

Outputs:

- Deterministic toolpath
- Requested machine position
- Requested external-axis positions
- Laser state
- Laser power
- Motion timing estimates
- Required synchronization barriers

Use a structured intermediate representation rather than directly generating G-code from UI objects.

Example:

```typescript
interface MotionSegment {
  start: MachinePosition;
  end: MachinePosition;
  laserEnabled: boolean;
  laserPower: number;
  feedRate: number;
  kind: "travel" | "mark" | "dwell";
}

interface MachinePosition {
  galvoX: number;
  galvoY: number;
  rotaryA: number;
  linearU: number;
}
```

Treat this as an illustrative design, not a mandatory final API.

Implement:

- Line interpolation
- Arc/path approximation
- Acceleration constraints
- Motion bounds validation
- Coordinate transforms
- Toolpath visualization
- Estimated execution time
- Serialization
- Simulation

Acceleration and jerk handling must match the actual hardware capabilities. Do not impose invented physical limits.

Create a planner interface that can express motion with synchronized and non-synchronized segments.

---

# 12. EXTERNAL ESP32-S3 CONTROLLER

Implement firmware for an independent two-axis positioning controller.

The hardware initially uses:

- ESP32-S3
- Two TMC2209 stepper drivers
- Rotary A motor
- Linear U motor
- Homing input for U
- Optional rotary index input
- Optional encoder feedback
- Hardware emergency stop
- Driver enable signals
- USB serial interface

The firmware must support:

- Absolute moves
- Relative moves
- Coordinated two-axis movement
- Configurable steps/mm
- Configurable steps/revolution
- Acceleration
- Maximum velocity
- Homing
- Soft limits
- Driver enable/disable
- State reporting
- Position reporting
- Error reporting
- Emergency stop
- Motion completion acknowledgments

Define a versioned serial protocol with:

- Frame validation
- Checksums or CRC
- Sequence numbers
- Request/response correlation
- Capability reporting
- Protocol version reporting
- Device error codes
- Busy/idle state
- Movement-in-progress state
- Explicit movement completion

Do not use a simplistic `OK` response ambiguously for both command acceptance and movement completion.

Implement separate statuses such as:

```text
ACCEPTED
STARTED
COMPLETED
REJECTED
FAULT
```

These names are illustrative.

The actual binary or textual packet format should be designed for reliability and debugability.

Include a host-side motion-controller emulator so the desktop application can be developed without any ESP32 connected.

The firmware must not independently authorize laser emission.

The controller must default to motor-disabled or appropriately safe behavior when communication or initialization fails.

---

# 13. HARDWARE CONFIGURATION

Create a hardware configuration interface.

Allow editing:

- Motor steps/revolution
- Microstepping
- Gear reduction
- Leadscrew pitch
- Axis direction
- Rotary home offset
- Linear home offset
- Maximum travel
- Velocity limits
- Acceleration limits
- Encoder resolution
- Limit-switch polarity
- Soft limits

Proposed initial mechanical values:

```text
Rotary motor: NEMA 17
Rotary transmission: 3:1 belt
Linear motor: NEMA 17
Linear drive: TR8x2 leadscrew
Linear rail: MGN12H
Usable linear travel: approximately 200 mm
```

Treat these as configurable examples rather than fixed characteristics.

Never hardcode mechanical dimensions into application logic.

Include a machine-profile export and import feature.

---

# 14. CALIBRATION TOOLS

Build calibration utilities into the application.

## Rotary calibration

- Commanded angular distance
- Measured angular distance
- Steps per revolution
- Gear ratio verification
- Backlash measurement
- Direction verification

## Linear calibration

- Commanded travel
- Measured travel
- Steps per millimeter
- Homing repeatability
- Backlash
- Soft-limit validation

## Galvo calibration

- Coordinate scaling
- Working-field dimensions
- Local-field position
- Galvo orientation
- Geometric distortion compensation, if supported by evidence
- Calibration grid generation

## Cylindrical calibration

- Cylinder diameter
- Angular registration
- Seam registration
- Axial registration
- Workpiece eccentricity, where measurable
- Repeatability across multiple sections

Support recording calibration results for individual machine profiles.

---

# 15. SIMULATOR — REQUIRED FROM DAY ONE

Develop a complete software-only simulator.

No physical F1 or ESP32 hardware should be needed to:

- Start the application
- Connect to a simulated machine
- Import artwork
- Generate paths
- Preview engraving
- Simulate motion
- Inspect commands
- Simulate pauses
- Simulate emergency stops
- Simulate communication failures

The simulator must reproduce the application-level device interface.

Provide:

- Virtual galvo positions
- Virtual rotary position
- Virtual axial position
- Simulated laser emission state
- Configurable execution latency
- Configurable communication latency
- Error injection
- Limit-switch events
- Device disconnects
- Command queue behavior

Create a timeline viewer showing:

```text
time
galvo X
galvo Y
rotary A
linear U
laser enable
laser power
device state
```

This timeline will be especially useful when investigating synchronization.

Use a monotonic simulation clock.

Support deterministic, repeatable simulation runs.

Do not use real wall-clock timing as the primary basis for test assertions.

---

# 16. SAFETY ARCHITECTURE

Laser safety must be part of the core architecture.

Never make actual laser emission possible merely by connecting to the device.

The software must default to a disarmed state.

Use an explicit state machine, with conceptual states such as:

```text
DISCONNECTED
CONNECTED
IDLE
PREPARING
READY
ARMED
RUNNING
PAUSED
STOPPING
FAULT
ESTOP
```

Define valid transitions explicitly.

At minimum:

- Start disarmed
- Require user action before arm
- Validate job bounds
- Validate selected laser source
- Validate machine mode
- Require confirmed external controller readiness when needed
- Disable execution when limits are unknown
- Stop on communication loss
- Stop on external motion-controller fault
- Prevent conflicting jobs
- Prevent simultaneous control from competing applications
- Require explicit recovery after faults

Do not automatically resume laser emission after reconnection.

Emergency stop must remain effective independently of the application. Provide or require a physical hardware stop that removes the relevant hazardous actuation/laser enable, rather than treating a GUI button as equivalent.

Do not bypass existing F1 safety interlocks.

If custom hardware prevents the stock enclosure from closing, the system must not be used for laser emission until an appropriate laser-rated enclosure, interlock arrangement, and fume extraction are in place.

Add a `simulationOnly` setting that is enabled by default.

During early development, all real-device write commands must be behind explicit developer-mode gates.

Laser-emission commands must remain disabled until their semantics and safety behavior are validated.

---

# 17. JOB EXECUTION ENGINE

Implement a reliable job manager.

Each job should contain:

- Project snapshot
- Machine profile
- Workpiece geometry
- Toolpath
- Laser parameters
- Execution strategy
- Required capabilities
- Calibration dependencies
- Validation result
- Estimated processing time

The execution engine must distinguish:

1. Command prepared
2. Command transmitted
3. Command accepted
4. Command executing
5. Command completed

Not all devices will expose all stages.

Never fabricate missing state feedback.

For multi-device execution, use explicit sequencing rules.

Example for indexed engraving:

```text
MOVE_EXTERNAL_AXES
WAIT_EXTERNAL_COMPLETION
VERIFY_EXTERNAL_POSITION
PREPARE_F1_SECTION
EXECUTE_F1_SECTION
WAIT_F1_COMPLETION
VERIFY_F1_IDLE
ADVANCE_TO_NEXT_SECTION
```

Include robust handling of:

- Timeouts
- USB disconnects
- Network disconnects
- Device faults
- Partial job completion
- Lost responses
- Duplicate messages
- Unexpected reboots
- User cancellation

Persist enough information to diagnose incomplete jobs.

Resume functionality must never automatically repeat a potentially dangerous section without confirming the machine's physical state.

---

# 18. G-CODE ENGINE

Implement a G-code parser that understands at least:

- G0
- G1
- G2/G3, if required by supported workflows
- G90
- G91
- G92
- Common feed-rate parameters
- Laser power parameters
- M-code handling
- Comments
- Unknown-command preservation

Do not assume ordinary CNC G-code semantics always match the F1's dialect.

Separate:

- Generic G-code syntax
- F1-specific command dialect
- External-controller command dialect

Provide:

- Parser
- Validator
- Intermediate representation
- Formatter
- Command viewer
- Syntax highlighting
- Coordinate analyzer

Unknown machine commands must not be silently interpreted as valid motion.

Support explicit command allowlists for the real machine.

---

# 19. LASER SOURCE MANAGEMENT

Create an abstraction for multiple laser sources.

Initially model:

- Blue diode source
- Infrared source

Each source should provide:

- Identifier
- Availability
- Power range
- Compatible processing capabilities
- Configurable material presets
- Known limitations

Research and verify source-switching commands.

Never assume that commands derived from one source apply identically to another.

Allow material presets, but do not market unvalidated parameters as safe or production-ready.

---

# 20. PROJECT FILE FORMAT

Create a documented native project format.

Suggested extension:

`.ols`

Use a structured container containing:

- Manifest
- Project version
- Artwork
- Object metadata
- Processing layers
- Laser settings
- Machine configuration reference
- Workpiece geometry
- Cylinder wrapping configuration
- Preview thumbnail

Avoid serializing framework-specific React or canvas objects.

Support schema evolution and migration.

Prefer a transparent, inspectable representation such as JSON plus embedded assets in a ZIP container.

The file format should be usable independently of the desktop GUI.

---

# 21. TESTING REQUIREMENTS

Implement tests throughout development.

## Geometry tests

Test:

- Flat-to-cylinder mapping
- Cylinder-to-flat mapping
- Diameter changes
- Multiple revolutions
- Helix calculations
- Coordinate transformations
- Rotation direction
- Seam handling
- Axial limits

## Motion tests

Test:

- Absolute movement
- Relative movement
- Two-axis interpolation
- Acceleration constraints
- Segment generation
- Out-of-bounds paths
- Motion interruption
- Homing behavior

## Protocol tests

Use recorded and synthetic fixtures.

Test:

- Partial TCP frames
- Multiple messages per read
- Corrupted messages
- Lost acknowledgments
- Delayed acknowledgments
- Disconnects
- Timeouts
- Unexpected messages
- Device busy conditions

## Safety tests

Test:

- Startup always disarmed
- No execution when disconnected
- No execution when external controller faults
- No automatic restart after emergency stop
- No laser emission during disallowed transitions
- No unexpected command replay after reconnection
- No duplicate motion on retry

## UI tests

Test:

- Open/save
- Artwork import
- Object transformations
- Layer settings
- Switching machine modes
- Simulation controls
- Job preparation
- Error presentation

Use unit, integration and end-to-end tests.

Favor deterministic tests over timing-dependent tests.

---

# 22. DEVELOPMENT PHASES

Do not attempt to implement everything simultaneously.

Deliver incremental, executable milestones.

## Phase 0 — Research and architecture

Goals:

- Inspect source repositories
- Study F1 protocol
- Document known commands
- Identify unknowns
- Define architecture
- Choose dependencies
- Establish repository structure

Deliverables:

- Research documentation
- Architecture diagrams
- Buildable project skeleton
- Development scripts
- README
- Architecture decision records

## Phase 1 — Working desktop studio

Goals:

- Launch Tauri application
- Build responsive desktop layout
- Add vector canvas
- Add object selection
- Add rectangles, ellipses and text
- Add SVG import
- Add save/load
- Implement simulated machine status

Deliverable:

A usable offline design editor.

No real hardware required.

## Phase 2 — Toolpath generation

Goals:

- Convert vector paths into ordered motion segments
- Implement travel/mark separation
- Implement laser layers
- Add path preview
- Implement G-code inspection
- Generate simulation timeline

Deliverable:

A functioning design-to-toolpath pipeline.

## Phase 3 — F1 communication

Goals:

- Implement BeamInk-informed transport
- Query machine information
- Confirm device communication
- Build protocol inspector
- Implement safe command classification
- Test laser-disabled behavior
- Support verified lifecycle operations

Deliverable:

A connected F1 backend with simulator fallback and no unvalidated laser output.

## Phase 4 — External controller

Goals:

- Create ESP32-S3 firmware
- Implement host transport
- Implement linear and rotary commands
- Implement homing
- Implement calibration
- Test completion acknowledgments
- Integrate virtual controller

Deliverable:

A functioning standalone two-axis motion subsystem.

## Phase 5 — Cylindrical editor

Goals:

- Add cylinder workspace
- Implement wrapping
- Add 3D preview
- Implement axial/rotary toolpaths
- Add machine profile
- Implement indexed section generation

Deliverable:

A complete simulated cylindrical engraving workflow.

## Phase 6 — Indexed engraving integration

Goals:

- Coordinate external positioning with F1 engraving
- Implement execution barriers
- Verify idle/completion semantics
- Track section state
- Test repeatability
- Develop registration procedures

Deliverable:

A hardware-testable indexed engraving workflow, only enabled after validation.

## Phase 7 — Synchronization research

Goals:

- Instrument command timing
- Investigate F1 buffering
- Investigate U-axis timing
- Test simultaneous axis commands in controlled conditions
- Measure motion/laser latency
- Evaluate achievable synchronization accuracy

Deliverables:

- Experimental data
- Timing diagrams
- Protocol evidence
- Feasibility report
- Decision on continuous engraving strategy

## Phase 8 — Advanced coordinated engraving

Implement only the synchronization features justified by actual measurements.

Do not label a feature complete merely because the simulator can execute it.

---

# 23. DOCUMENTATION

Maintain documentation throughout development.

Required documents:

```text
README.md
CONTRIBUTING.md
docs/architecture/OVERVIEW.md
docs/architecture/MOTION_MODEL.md
docs/architecture/JOB_EXECUTION.md
docs/research/F1_PROTOCOL.md
docs/research/PROTOCOL_EVIDENCE.md
docs/research/OPEN_QUESTIONS.md
docs/hardware/ESP32_CONTROLLER.md
docs/hardware/WIRING.md
docs/development/GETTING_STARTED.md
docs/development/TESTING.md
docs/user-guide/CYLINDRICAL_ENGRAVING.md
docs/SAFETY.md
```

Include actual architecture diagrams, preferably Mermaid, where appropriate.

Clearly distinguish implemented functionality from planned functionality.

---

# 24. USER EXPERIENCE REQUIREMENTS

Prioritize an attractive, functional desktop engineering application.

Design principles:

- Clean, professional layout
- High information density
- Dark and light themes
- Precise numeric inputs
- Responsive canvas
- Keyboard shortcuts
- Dockable or resizable panels
- Clear tool states
- Minimal interruptions
- Consistent icons
- Helpful tooltips
- Detailed diagnostics available without cluttering the default UI

The initial visual layout can be inspired by the general workflows of LightBurn, Inkscape, Fusion 360 and professional CAD/CAM software.

Do not clone copyrighted application assets.

The interface should visibly distinguish:

- Design mode
- Simulation mode
- Device-connected mode
- Armed machine state
- Running job
- Fault state

Make simulation extremely easy to use.

The first launch should open into a functional sample project rather than an empty, confusing application.

---

# 25. ENGINEERING QUALITY

Adopt the following rules:

- TypeScript strict mode
- Rust formatting and linting
- No silent error suppression
- No hardcoded device IP without configuration
- No hardcoded machine dimensions
- Structured logging
- Versioned protocols
- Explicit units
- Separate transport and business logic
- Dependency injection for devices
- Mockable hardware interfaces
- Testable geometry functions
- Reproducible builds

Use clear names and avoid unnecessary abstraction.

Keep domain logic independent from UI frameworks.

Maintain a `CHANGELOG.md`.

When changing protocol assumptions, update the associated research documentation.

---

# 26. IMPORTANT ENGINEERING QUESTIONS

Investigate and document answers to these questions.

### F1 communication

1. What protocol does the original F1 actually expose?
2. Does TCP port 8780 work on current firmware?
3. Does it support command streaming and buffered jobs?
4. How does it acknowledge commands?
5. Can execution completion be distinguished from receipt?
6. How is the laser source selected?
7. How is laser emission enabled and disabled?
8. Does an idle response guarantee all pending marking has finished?
9. What happens on TCP disconnect?
10. Does USB networking behave differently on Windows and Linux?

### Multi-axis capabilities

11. Does the F1 firmware support independent U-axis positioning?
12. Can U-axis motion overlap with galvo motion?
13. What does `M116` actually change internally?
14. Can multiple mappings coexist?
15. Are motion commands queued in order?
16. Does buffering affect command completion?
17. Can G-code motion be segmented reliably?
18. Is any real-time feedback available for the rotary output?

### Synchronization

19. What is the minimum observable command latency?
20. How variable is that latency?
21. Can the F1 expose deterministic execution boundaries?
22. Can external axis movement be coordinated with laser-off segments?
23. Could a physical synchronization signal be obtained without compromising safety?
24. Can galvo field positioning compensate for small external mechanical movements?
25. What is the maximum safe synchronized segment duration or distance supported by evidence?

### Software

26. Which geometry library is best suited for the editor?
27. What architecture minimizes code duplication across machine types?
28. How should synchronized movement be represented in the intermediate toolpath?
29. What execution modes can be offered without deterministic synchronization?
30. What portions of BeamInk can be reused appropriately?

Do not postpone the entire application until these questions are resolved.

Track unknowns and continue developing independent components.

---

# 27. IMMEDIATE FIRST IMPLEMENTATION TASK

Begin development now.

Do the following in order:

1. Inspect the development environment and available tools.
2. Create the project repository.
3. Inspect BeamInk and the reference repositories.
4. Write a concise findings report with verified facts and unknowns.
5. Initialize the Tauri 2 + React + TypeScript application.
6. Create the desktop interface layout.
7. Implement the editor's core data model.
8. Create a functioning SVG canvas with selection, pan and zoom.
9. Implement rectangles, ellipses and lines.
10. Add basic object transformations.
11. Implement a simulator device.
12. Add a simulated connection/status panel.
13. Create the Rust device abstraction.
14. Implement the first basic toolpath generator.
15. Display generated toolpaths in the interface.
16. Add unit tests for coordinate transformations.
17. Add a dedicated cylindrical workspace placeholder with a functioning cylinder-unwrapping calculation.
18. Run the application and resolve startup, build, lint and test errors.
19. Document exactly how to launch and test the project.
20. Record the remaining work as prioritized milestones.

At the end of the first implementation pass, provide:

- Files created
- Architecture overview
- Features implemented
- Tests executed
- Known problems
- Protocol discoveries
- Current simulator capabilities
- Immediate next engineering tasks

If a task is blocked, document the blocker and continue with other work.

Do not stop after writing a plan or README.

**The first milestone is complete only when there is a functioning desktop application with a usable editing canvas, simulated machine connection, and a working design-to-toolpath preview.**

---

# 28. LONG-TERM SUCCESS CRITERIA

The project is ultimately successful when a user can:

1. Open Open Laser Studio.
2. Connect to an xTool F1.
3. Configure a custom two-axis rotary-linear attachment.
4. Create artwork on an unwrapped cylindrical canvas.
5. Preview the artwork on a 3D cylinder.
6. Generate a machine-aware toolpath.
7. Preview all four machine coordinates and laser states.
8. Validate mechanical limits and synchronization requirements.
9. Execute an engraving job with verified safe sequencing.
10. Engrave cylindrical objects longer than the F1's ordinary marking field.

The first production-grade implementation may use indexed engraving.

Fully continuous, synchronized multi-axis engraving is a research milestone whose feasibility must be demonstrated rather than assumed.

Prioritize technical correctness, modularity, usability and reproducible experimental results.

**Start by researching the references, creating the repository, and implementing Phase 0 and Phase 1. Proceed with actual development immediately.**