//! Raster engraving: grayscale → dither → scanline runs in image-local millimetres.

use image::GrayImage;
use laser_project::DitherMode;

/// One laser-on run on a scanline, image-local mm, with relative power 0..=1.
#[derive(Debug, Clone, PartialEq)]
pub struct RasterRun {
    pub y_mm: f64,
    pub x0_mm: f64,
    pub x1_mm: f64,
    pub intensity: f64,
}

/// Box-resample to `w × h`.
pub fn resample(img: &GrayImage, w: u32, h: u32) -> Vec<f64> {
    let (sw, sh) = (img.width().max(1), img.height().max(1));
    let mut out = vec![0.0; (w * h) as usize];
    for y in 0..h {
        let y0 = (f64::from(y) * f64::from(sh) / f64::from(h)).floor() as u32;
        let y1 = ((f64::from(y + 1) * f64::from(sh) / f64::from(h)).ceil() as u32).clamp(y0 + 1, sh);
        for x in 0..w {
            let x0 = (f64::from(x) * f64::from(sw) / f64::from(w)).floor() as u32;
            let x1 = ((f64::from(x + 1) * f64::from(sw) / f64::from(w)).ceil() as u32).clamp(x0 + 1, sw);
            let mut sum = 0.0;
            let mut n = 0.0_f64;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    sum += f64::from(img.get_pixel(xx.min(sw - 1), yy.min(sh - 1)).0[0]);
                    n += 1.0;
                }
            }
            out[(y * w + x) as usize] = sum / n.max(1.0);
        }
    }
    out
}

/// Darkness 0..=1 per pixel (1 = full burn) after dithering.
pub fn dither(gray: &[f64], w: u32, h: u32, mode: DitherMode, threshold: u8, invert: bool) -> Vec<f64> {
    let mut dark: Vec<f64> = gray
        .iter()
        .map(|v| {
            let d = 1.0 - v / 255.0;
            if invert { 1.0 - d } else { d }
        })
        .collect();
    let t = 1.0 - f64::from(threshold) / 255.0;
    match mode {
        DitherMode::Grayscale => {
            // Quantize to 8 levels so runs stay reasonably long.
            for v in &mut dark {
                *v = (*v * 8.0).round() / 8.0;
            }
        }
        DitherMode::Threshold => {
            for v in &mut dark {
                *v = if *v >= t { 1.0 } else { 0.0 };
            }
        }
        DitherMode::FloydSteinberg => {
            let (w, h) = (w as usize, h as usize);
            for y in 0..h {
                for x in 0..w {
                    let i = y * w + x;
                    let old = dark[i];
                    let new = if old >= 0.5 { 1.0 } else { 0.0 };
                    dark[i] = new;
                    let err = old - new;
                    if x + 1 < w {
                        dark[i + 1] += err * 7.0 / 16.0;
                    }
                    if y + 1 < h {
                        if x > 0 {
                            dark[i + w - 1] += err * 3.0 / 16.0;
                        }
                        dark[i + w] += err * 5.0 / 16.0;
                        if x + 1 < w {
                            dark[i + w + 1] += err / 16.0;
                        }
                    }
                }
            }
        }
    }
    dark
}

/// Scanline runs for an image placed at local `[0, width_mm] × [0, height_mm]`.
pub fn raster_runs(
    img: &GrayImage,
    width_mm: f64,
    height_mm: f64,
    lines_per_mm: f64,
    mode: DitherMode,
    threshold: u8,
    invert: bool,
    bidirectional: bool,
) -> Vec<RasterRun> {
    let lpm = lines_per_mm.clamp(0.5, 50.0);
    let w = ((width_mm * lpm).round() as u32).clamp(1, 8000);
    let h = ((height_mm * lpm).round() as u32).clamp(1, 8000);
    let gray = resample(img, w, h);
    let dark = dither(&gray, w, h, mode, threshold, invert);
    let px_w = width_mm / f64::from(w);
    let px_h = height_mm / f64::from(h);
    let mut out = Vec::new();
    for y in 0..h {
        let y_mm = (f64::from(y) + 0.5) * px_h;
        let mut row = Vec::new();
        let mut x = 0;
        while x < w {
            let v = dark[(y * w + x) as usize];
            if v <= 1e-6 {
                x += 1;
                continue;
            }
            let start = x;
            while x < w && (dark[(y * w + x) as usize] - v).abs() < 1e-6 {
                x += 1;
            }
            row.push(RasterRun { y_mm, x0_mm: f64::from(start) * px_w, x1_mm: f64::from(x) * px_w, intensity: v.min(1.0) });
        }
        if bidirectional && y % 2 == 1 {
            row.reverse();
            for r in &mut row {
                std::mem::swap(&mut r.x0_mm, &mut r.x1_mm);
            }
        }
        out.extend(row);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_square_threshold() {
        let mut img = GrayImage::from_pixel(10, 10, image::Luma([255]));
        for y in 0..5 {
            for x in 0..5 {
                img.put_pixel(x, y, image::Luma([0]));
            }
        }
        let runs = raster_runs(&img, 10.0, 10.0, 1.0, DitherMode::Threshold, 128, false, true);
        assert_eq!(runs.len(), 5);
        assert!((runs[0].x1_mm - runs[0].x0_mm - 5.0).abs() < 1e-9);
        // Second row reversed.
        assert!(runs[1].x0_mm > runs[1].x1_mm);
    }

    #[test]
    fn floyd_steinberg_preserves_mean() {
        let gray = vec![128.0; 100];
        let d = dither(&gray, 10, 10, DitherMode::FloydSteinberg, 128, false);
        let mean: f64 = d.iter().sum::<f64>() / 100.0;
        assert!((mean - 0.5).abs() < 0.1, "mean {mean}");
    }

    #[test]
    fn invert_and_white_image() {
        let img = GrayImage::from_pixel(4, 4, image::Luma([255]));
        assert!(raster_runs(&img, 4.0, 4.0, 1.0, DitherMode::Threshold, 128, false, false).is_empty());
        assert_eq!(raster_runs(&img, 4.0, 4.0, 1.0, DitherMode::Threshold, 128, true, false).len(), 4);
    }
}
