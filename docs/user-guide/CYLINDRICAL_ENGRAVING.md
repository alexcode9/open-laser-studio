# Cylindrical engraving (simulation)

Milestone 1 lets you design, plan and **simulate** cylindrical jobs. Nothing is sent to a real
laser.

## 1. Describe the workpiece

Open **Setup → Workpiece** and enter:

- **Diameter**: measure it with calipers where you will engrave. The circumference `π·D` sets the
  height of the unwrapped canvas.
- **Length**: the usable axial length.
- **Angular zero** and **axial zero**: where design `s = 0` and `u = 0` sit on the machine.
- **Rotation sign**: flip it if the preview rotates the wrong way compared with your rotary.

## 2. Design on the unwrapped surface

Switch the top bar to **Cylinder**. The canvas is the unwrapped surface: horizontal is along the
axis (u) and vertical is around the circumference (s). Dashed **seam** lines mark one full turn.
Ghost copies show artwork that wraps past the seam. The status bar shows A (deg) and U (mm) under
the cursor.

Tools: select (V), pan (H), rectangle (R), ellipse (E), polyline (L) and text (T). You can also import
SVG (Ctrl+I) or an image. Each layer has a mode (line, fill or image) and its own laser settings.

## 3. Choose a strategy

**Setup → Cylinder job**:

- **Indexed** (recommended): the surface is cut into sections that fit the galvo field and stay
  within **max focus error** (the drop below focus at the section edge, `R(1 − cos(ds/R))`). The
  workpiece moves between sections with the laser off. Section boundaries appear on the canvas.
- **Coupled** (experimental, simulation only): the workpiece moves continuously under a fixed
  beam. It cannot run on hardware, because the F1 offers no known way to synchronize with the
  external axes.

The **Plan** tab lists sections, warnings, errors and the estimated time. A plan marked
*executable* can be prepared and run in the simulator.

## 4. Preview and simulate

- The 3D view shows the cylinder with your artwork, the toolpath, the galvo head and the beam.
  Use the timeline (bottom) to scrub; the A, U, galvo and laser lanes stay in sync with the 3D spot.
- **Machine tab**: Connect → Home → Prepare → Arm (checklist) → Start. Use **Live** to follow the
  running job. Faults can be injected from the same panel to see how the job stops.
- **Esc** or the red **E-STOP** button stops immediately. Reset requires confirming that the
  physical E-stop has been released.

## 5. Calibrate (for later hardware work)

**Setup → Calibration** computes corrected steps-per-unit from a commanded and a measured move,
and folds the correction into the axis gear ratio in the machine profile.
