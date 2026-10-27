//! `.ols` container: a ZIP archive with transparent JSON and separate asset files.
//!
//! ```text
//! manifest.json        format id, schema version, file index
//! project.json         Project JSON; assets replaced by "ols-asset:<path>" references
//! assets/<id>.<ext>    binary assets (images)
//! thumbnail.png        optional preview
//! ```

use std::io::{Cursor, Read, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use laser_core::{CoreError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Project;

pub const OLS_FORMAT: &str = "open-laser-studio";
pub const OLS_SCHEMA_VERSION: u32 = 1;
const ASSET_REF: &str = "ols-asset:";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    schema_version: u32,
    app_version: String,
    project: String,
    assets: Vec<String>,
    thumbnail: Option<String>,
}

fn zip_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Io(format!("ols archive: {e}"))
}

fn split_data_url(url: &str) -> Option<(&str, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let mime = meta.strip_suffix(";base64")?;
    let bytes = B64.decode(data).ok()?;
    Some((mime, bytes))
}

fn ext_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

pub fn save_ols(project: &Project, thumbnail_png: Option<&[u8]>) -> Result<Vec<u8>> {
    let mut p = project.clone();
    p.schema_version = OLS_SCHEMA_VERSION;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for (id, url) in p.assets.iter_mut() {
        if let Some((mime, bytes)) = split_data_url(url) {
            let safe: String =
                id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
            let path = format!("assets/{safe}.{}", ext_for(mime));
            files.push((path.clone(), bytes));
            *url = format!("{ASSET_REF}{path}");
        }
    }
    let manifest = Manifest {
        format: OLS_FORMAT.into(),
        schema_version: OLS_SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        project: "project.json".into(),
        assets: files.iter().map(|(p, _)| p.clone()).collect(),
        thumbnail: thumbnail_png.map(|_| "thumbnail.png".into()),
    };

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", opts).map_err(zip_err)?;
        zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
        zip.start_file("project.json", opts).map_err(zip_err)?;
        zip.write_all(serde_json::to_string_pretty(&p)?.as_bytes())?;
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (path, bytes) in &files {
            zip.start_file(path.as_str(), stored).map_err(zip_err)?;
            zip.write_all(bytes)?;
        }
        if let Some(png) = thumbnail_png {
            zip.start_file("thumbnail.png", stored).map_err(zip_err)?;
            zip.write_all(png)?;
        }
        zip.finish().map_err(zip_err)?;
    }
    Ok(buf.into_inner())
}

fn read_entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>> {
    let mut f = zip.by_name(name).map_err(|e| CoreError::Parse(format!("missing {name}: {e}")))?;
    let mut out = Vec::new();
    f.read_to_end(&mut out)?;
    Ok(out)
}

/// Schema migrations. Each step upgrades exactly one version.
pub fn migrate(mut value: Value) -> Result<Value> {
    let mut version = value.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0) as u32;
    if version > OLS_SCHEMA_VERSION {
        return Err(CoreError::Unsupported(format!(
            "project schema {version} is newer than supported {OLS_SCHEMA_VERSION}"
        )));
    }
    while version < OLS_SCHEMA_VERSION {
        match version {
            // v0 (pre-release drafts) had no schemaVersion and no `cylinder` settings.
            0 => {
                if let Some(obj) = value.as_object_mut() {
                    obj.entry("cylinder").or_insert_with(|| serde_json::json!({}));
                }
            }
            _ => unreachable!("missing migration step"),
        }
        version += 1;
        value["schemaVersion"] = Value::from(version);
    }
    Ok(value)
}

pub fn load_ols(bytes: &[u8]) -> Result<(Project, Option<Vec<u8>>)> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(zip_err)?;
    let manifest: Manifest = serde_json::from_slice(&read_entry(&mut zip, "manifest.json")?)?;
    if manifest.format != OLS_FORMAT {
        return Err(CoreError::Parse(format!("not an Open Laser Studio file: {}", manifest.format)));
    }
    let raw: Value = serde_json::from_slice(&read_entry(&mut zip, &manifest.project)?)?;
    let mut project: Project = serde_json::from_value(migrate(raw)?)?;
    let refs: Vec<(String, String)> = project
        .assets
        .iter()
        .filter_map(|(id, v)| v.strip_prefix(ASSET_REF).map(|p| (id.clone(), p.to_string())))
        .collect();
    for (id, path) in refs {
        let data = read_entry(&mut zip, &path)?;
        project.assets.insert(id, format!("data:{};base64,{}", mime_for(&path), B64.encode(data)));
    }
    let thumb = match &manifest.thumbnail {
        Some(t) => Some(read_entry(&mut zip, t)?),
        None => None,
    };
    Ok((project, thumb))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_project;

    #[test]
    fn roundtrip_with_assets_and_thumbnail() {
        let mut p = sample_project();
        p.assets.insert("img/1".into(), format!("data:image/png;base64,{}", B64.encode([1u8, 2, 3])));
        let bytes = save_ols(&p, Some(&[9, 9])).unwrap();
        let (back, thumb) = load_ols(&bytes).unwrap();
        assert_eq!(back, p);
        assert_eq!(thumb, Some(vec![9, 9]));
    }

    #[test]
    fn rejects_newer_schema() {
        assert!(migrate(serde_json::json!({"schemaVersion": 99})).is_err());
    }

    #[test]
    fn migrates_v0() {
        let v = migrate(serde_json::json!({"name": "old"})).unwrap();
        assert_eq!(v["schemaVersion"], 1);
        let p: Project = serde_json::from_value(v).unwrap();
        assert_eq!(p.name, "old");
    }
}
