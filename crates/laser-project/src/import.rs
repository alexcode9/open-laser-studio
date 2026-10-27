//! SVG import, text outlining (both via usvg) and raster asset decoding.

use std::sync::{Arc, OnceLock};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use laser_core::{CoreError, Result};
use laser_geometry::{Affine2, PathCmd, Point};
use usvg::tiny_skia_path::PathSegment;

/// usvg resolves absolute units at 96 user units per inch.
const PX_TO_MM: f64 = 25.4 / 96.0;

fn fontdb() -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        tracing::info!(faces = db.len(), "loaded system fonts");
        Arc::new(db)
    })
    .clone()
}

fn options() -> usvg::Options<'static> {
    usvg::Options { fontdb: fontdb(), ..Default::default() }
}

/// One imported vector path with commands in millimetres (document coordinates).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPath {
    pub id: String,
    pub commands: Vec<PathCmd>,
    pub stroke_color: Option<String>,
    pub fill_color: Option<String>,
}

fn color_hex(c: usvg::Color) -> String {
    format!("#{:02x}{:02x}{:02x}", c.red, c.green, c.blue)
}

fn paint_hex(p: &usvg::Paint) -> Option<String> {
    match p {
        usvg::Paint::Color(c) => Some(color_hex(*c)),
        _ => Some("#000000".into()),
    }
}

fn to_affine(t: usvg::Transform) -> Affine2 {
    Affine2([f64::from(t.sx), f64::from(t.ky), f64::from(t.kx), f64::from(t.sy), f64::from(t.tx), f64::from(t.ty)])
}

fn path_to_cmds(path: &usvg::Path, extra: &Affine2) -> Vec<PathCmd> {
    let t = extra.mul(&to_affine(path.abs_transform()));
    let ap = |x: f32, y: f32| t.apply(Point::new(f64::from(x), f64::from(y)));
    let mut out = Vec::new();
    for seg in path.data().segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                let p = ap(p.x, p.y);
                out.push(PathCmd::M { x: p.x, y: p.y });
            }
            PathSegment::LineTo(p) => {
                let p = ap(p.x, p.y);
                out.push(PathCmd::L { x: p.x, y: p.y });
            }
            PathSegment::QuadTo(p1, p) => {
                let (a, b) = (ap(p1.x, p1.y), ap(p.x, p.y));
                out.push(PathCmd::Q { x1: a.x, y1: a.y, x: b.x, y: b.y });
            }
            PathSegment::CubicTo(p1, p2, p) => {
                let (a, b, c) = (ap(p1.x, p1.y), ap(p2.x, p2.y), ap(p.x, p.y));
                out.push(PathCmd::C { x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: c.x, y: c.y });
            }
            PathSegment::Close => out.push(PathCmd::Z),
        }
    }
    out
}

fn collect(group: &usvg::Group, extra: &Affine2, out: &mut Vec<ImportedPath>) {
    for node in group.children() {
        match node {
            usvg::Node::Group(g) => collect(g, extra, out),
            usvg::Node::Path(p) => {
                if !p.is_visible() {
                    continue;
                }
                let commands = path_to_cmds(p, extra);
                if commands.is_empty() {
                    continue;
                }
                out.push(ImportedPath {
                    id: p.id().to_string(),
                    commands,
                    stroke_color: p.stroke().and_then(|s| paint_hex(s.paint())),
                    fill_color: p.fill().and_then(|f| paint_hex(f.paint())),
                });
            }
            usvg::Node::Text(t) => collect(t.flattened(), extra, out),
            usvg::Node::Image(_) => {}
        }
    }
}

/// Parse SVG text into vector paths in millimetres. Text is converted to outlines.
pub fn import_svg(svg: &str) -> Result<Vec<ImportedPath>> {
    let tree = usvg::Tree::from_str(svg, &options())
        .map_err(|e| CoreError::Parse(format!("svg: {e}")))?;
    let mut out = Vec::new();
    collect(tree.root(), &Affine2::scale(PX_TO_MM, PX_TO_MM), &mut out);
    Ok(out)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Outline text with a system font. Coordinates: mm, text box top-left at the origin,
/// vertical center at `font_size_mm / 2` (matches Konva's text layout).
pub fn text_to_path(text: &str, font_size_mm: f64, font_family: &str) -> Result<Vec<PathCmd>> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut svg = String::from(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="1000mm" viewBox="0 0 1000 1000">"#,
    );
    for (i, line) in text.lines().enumerate() {
        let y = font_size_mm / 2.0 + i as f64 * font_size_mm;
        svg.push_str(&format!(
            r#"<text x="0" y="{y}" font-family="{}" font-size="{font_size_mm}" dominant-baseline="central" xml:space="preserve">{}</text>"#,
            xml_escape(font_family),
            xml_escape(line)
        ));
    }
    svg.push_str("</svg>");
    let paths = import_svg(&svg)?;
    if paths.is_empty() {
        return Err(CoreError::Unsupported(format!("no outlines produced (font '{font_family}' unavailable?)")));
    }
    Ok(paths.into_iter().flat_map(|p| p.commands).collect())
}

/// Decode a `data:image/...;base64,` URL into grayscale (transparent → white).
pub fn decode_data_url_gray(url: &str) -> Result<image::GrayImage> {
    let (_, data) = url
        .split_once(',')
        .ok_or_else(|| CoreError::Parse("invalid data URL".into()))?;
    let bytes = B64.decode(data.trim()).map_err(|e| CoreError::Parse(format!("base64: {e}")))?;
    let img = image::load_from_memory(&bytes).map_err(|e| CoreError::Parse(format!("image: {e}")))?;
    let rgba = img.to_rgba8();
    let mut gray = image::GrayImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let l = 0.299 * f64::from(r) + 0.587 * f64::from(g) + 0.114 * f64::from(b);
        let alpha = f64::from(a) / 255.0;
        let v = l * alpha + 255.0 * (1.0 - alpha);
        gray.put_pixel(x, y, image::Luma([v.round().clamp(0.0, 255.0) as u8]));
    }
    Ok(gray)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_units_are_mm() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
            <rect x="10" y="10" width="20" height="5" fill="red"/></svg>"#;
        let paths = import_svg(svg).unwrap();
        assert_eq!(paths.len(), 1);
        let pts: Vec<(f64, f64)> = paths[0]
            .commands
            .iter()
            .filter_map(|c| match c {
                PathCmd::M { x, y } | PathCmd::L { x, y } => Some((*x, *y)),
                _ => None,
            })
            .collect();
        let max_x = pts.iter().map(|p| p.0).fold(f64::MIN, f64::max);
        assert!((max_x - 30.0).abs() < 1e-3, "max_x = {max_x}");
        assert_eq!(paths[0].fill_color.as_deref(), Some("#ff0000"));
    }

    #[test]
    fn invalid_svg_is_error() {
        assert!(import_svg("<nope").is_err());
    }

    #[test]
    fn decode_png() {
        let mut img = image::RgbaImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
        img.put_pixel(1, 0, image::Rgba([0, 0, 0, 0]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let url = format!("data:image/png;base64,{}", B64.encode(png));
        let g = decode_data_url_gray(&url).unwrap();
        assert_eq!(g.get_pixel(0, 0).0[0], 0);
        assert_eq!(g.get_pixel(1, 0).0[0], 255);
    }
}
