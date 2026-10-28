//! `.ols` container: a ZIP archive with transparent JSON and separate asset files.
//!
//! ```text
//! manifest.json        format id, schema version, file index
//! project.json         Project JSON; assets replaced by "ols-asset:<path>" references
//! assets/<id>.<ext>    binary assets (images)
//! cad/<sha256>.<ext>   CAD source files, verbatim (schema v2); checksums in the manifest
//! thumbnail.png        optional preview
//! ```

use std::io::{Cursor, Read, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use laser_core::{CoreError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::Project;
use crate::cad::{cad_asset_path, is_sha256_hex};

pub const OLS_FORMAT: &str = "open-laser-studio";
pub const OLS_SCHEMA_VERSION: u32 = 2;
const ASSET_REF: &str = "ols-asset:";
/// Upper bound for one embedded CAD file (decompressed).
const MAX_CAD_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    schema_version: u32,
    app_version: String,
    project: String,
    assets: Vec<String>,
    thumbnail: Option<String>,
    #[serde(default)]
    cad_files: Vec<CadManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CadManifestEntry {
    path: String,
    sha256: String,
    bytes: u64,
}

/// A CAD source file inside the container.
#[derive(Debug, Clone, PartialEq)]
pub struct CadFile {
    pub path: String,
    pub sha256: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct LoadedOls {
    pub project: Project,
    pub thumbnail_png: Option<Vec<u8>>,
    /// CAD files that passed their checksum.
    pub cad_files: Vec<CadFile>,
    /// Recoverable problems (missing or corrupt CAD files). The project still opens.
    pub warnings: Vec<String>,
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
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

/// Write a project. `cad_files` must contain the source of every model in `project.cad`;
/// each file's checksum is verified against the model reference.
pub fn save_ols(project: &Project, thumbnail_png: Option<&[u8]>, cad_files: &[CadFile]) -> Result<Vec<u8>> {
    let mut p = project.clone();
    p.schema_version = OLS_SCHEMA_VERSION;
    let mut cad_entries: Vec<(CadManifestEntry, &[u8])> = Vec::new();
    if let Some(cad) = p.cad.as_mut() {
        for m in cad.models.iter_mut() {
            if !is_sha256_hex(&m.sha256) {
                return Err(CoreError::InvalidArgument(format!("CAD model '{}' has an invalid checksum", m.name)));
            }
            let file = cad_files
                .iter()
                .find(|f| f.sha256 == m.sha256)
                .ok_or_else(|| CoreError::InvalidArgument(format!("source file of CAD model '{}' was not provided", m.name)))?;
            if sha256_hex(&file.data) != m.sha256 {
                return Err(CoreError::InvalidArgument(format!("source file of CAD model '{}' does not match its checksum", m.name)));
            }
            let path = cad_asset_path(&m.sha256, m.source_type);
            m.asset_path = path.clone();
            if !cad_entries.iter().any(|(e, _)| e.path == path) {
                cad_entries.push((CadManifestEntry { path, sha256: m.sha256.clone(), bytes: file.data.len() as u64 }, &file.data));
            }
        }
    }
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
        cad_files: cad_entries.iter().map(|(e, _)| e.clone()).collect(),
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
        for (entry, data) in &cad_entries {
            zip.start_file(entry.path.as_str(), opts).map_err(zip_err)?;
            zip.write_all(data)?;
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
            // v1 -> v2 adds the optional `cad` workspace; v1 files have none. The version bump
            // makes older apps refuse v2 files instead of silently dropping CAD data.
            1 => {}
            _ => unreachable!("missing migration step"),
        }
        version += 1;
        value["schemaVersion"] = Value::from(version);
    }
    Ok(value)
}

fn read_cad_entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, path: &str) -> std::result::Result<Vec<u8>, String> {
    let f = zip.by_name(path).map_err(|_| "is missing from the archive".to_string())?;
    if f.size() > MAX_CAD_FILE_BYTES {
        return Err("exceeds the size limit".into());
    }
    let mut out = Vec::new();
    f.take(MAX_CAD_FILE_BYTES + 1).read_to_end(&mut out).map_err(|e| format!("could not be read: {e}"))?;
    if out.len() as u64 > MAX_CAD_FILE_BYTES {
        return Err("exceeds the size limit".into());
    }
    Ok(out)
}

pub fn load_ols(bytes: &[u8]) -> Result<LoadedOls> {
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

    let mut cad_files: Vec<CadFile> = Vec::new();
    let mut warnings = Vec::new();
    if let Some(cad) = project.cad.as_mut() {
        for m in cad.models.iter_mut() {
            // Only the content-addressed path is trusted; the stored `assetPath` is advisory.
            let path = cad_asset_path(&m.sha256, m.source_type);
            m.asset_path = path.clone();
            if cad_files.iter().any(|f| f.path == path) {
                continue;
            }
            if !is_sha256_hex(&m.sha256) {
                warnings.push(format!("CAD model '{}' has an invalid checksum and cannot be restored.", m.name));
                continue;
            }
            match read_cad_entry(&mut zip, &path) {
                Ok(data) if sha256_hex(&data) == m.sha256 => cad_files.push(CadFile { path, sha256: m.sha256.clone(), data }),
                Ok(_) => warnings.push(format!("The embedded file of CAD model '{}' is corrupt (checksum mismatch); the model was not restored.", m.name)),
                Err(e) => warnings.push(format!("The embedded file of CAD model '{}' {e}; the model was not restored.", m.name)),
            }
        }
    }
    Ok(LoadedOls { project, thumbnail_png: thumb, cad_files, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample::sample_project;

    #[test]
    fn roundtrip_with_assets_and_thumbnail() {
        let mut p = sample_project();
        p.assets.insert("img/1".into(), format!("data:image/png;base64,{}", B64.encode([1u8, 2, 3])));
        let bytes = save_ols(&p, Some(&[9, 9]), &[]).unwrap();
        let loaded = load_ols(&bytes).unwrap();
        assert_eq!(loaded.project, p);
        assert_eq!(loaded.thumbnail_png, Some(vec![9, 9]));
        assert!(loaded.cad_files.is_empty() && loaded.warnings.is_empty());
    }

    #[test]
    fn rejects_newer_schema() {
        assert!(migrate(serde_json::json!({"schemaVersion": 99})).is_err());
    }

    #[test]
    fn migrates_v0() {
        let v = migrate(serde_json::json!({"name": "old"})).unwrap();
        assert_eq!(v["schemaVersion"], OLS_SCHEMA_VERSION);
        let p: Project = serde_json::from_value(v).unwrap();
        assert_eq!(p.name, "old");
    }

    #[test]
    fn migrates_v1_without_cad() {
        let mut v1 = serde_json::to_value(sample_project()).unwrap();
        v1["schemaVersion"] = 1.into();
        v1.as_object_mut().unwrap().remove("cad");
        let v = migrate(v1).unwrap();
        assert_eq!(v["schemaVersion"], 2);
        let p: Project = serde_json::from_value(v).unwrap();
        assert!(p.cad.is_none());
    }

    mod cad {
        use super::*;
        use crate::cad::{CadModelRef, CadWorkspace, GeometrySourceType};
        use laser_geometry::Mat4;

        const STEP: &[u8] = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";

        fn model(data: &[u8]) -> CadModelRef {
            CadModelRef {
                id: "m1".into(),
                name: "Cylinder".into(),
                file_name: "cyl.step".into(),
                source_type: GeometrySourceType::Step,
                declared_unit: "millimetre".into(),
                unit_scale_to_mm: 1.0,
                units_confirmed: true,
                sha256: sha256_hex(data),
                byte_length: data.len() as u64,
                asset_path: String::new(),
                geometry_revision: "rev".into(),
                kernel_version: "k".into(),
                deflection_mm: 0.05,
                source_to_model: Mat4::IDENTITY,
                model_to_workpiece: Mat4::IDENTITY,
                hidden_parts: vec![],
            }
        }

        fn project_with(data: &[u8]) -> Project {
            let mut p = sample_project();
            p.cad = Some(CadWorkspace { models: vec![model(data)], ..CadWorkspace::default() });
            p
        }

        fn file(data: &[u8]) -> CadFile {
            CadFile { path: "ignored".into(), sha256: sha256_hex(data), data: data.to_vec() }
        }

        #[test]
        fn sha256_known_vector() {
            assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        }

        #[test]
        fn roundtrip_embeds_source_with_checksum() {
            let p = project_with(STEP);
            let bytes = save_ols(&p, None, &[file(STEP)]).unwrap();
            let loaded = load_ols(&bytes).unwrap();
            assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
            assert_eq!(loaded.cad_files.len(), 1);
            let f = &loaded.cad_files[0];
            assert_eq!(f.data, STEP);
            assert_eq!(f.path, format!("cad/{}.step", sha256_hex(STEP)));
            let m = &loaded.project.cad.as_ref().unwrap().models[0];
            assert_eq!(m.asset_path, f.path);
            let mut expected = p.clone();
            expected.cad.as_mut().unwrap().models[0].asset_path = f.path.clone();
            assert_eq!(loaded.project, expected);
        }

        #[test]
        fn save_requires_every_source_and_matching_checksum() {
            let p = project_with(STEP);
            assert!(save_ols(&p, None, &[]).is_err());
            let mut wrong = file(STEP);
            wrong.data.push(b'x');
            assert!(save_ols(&p, None, &[wrong]).is_err());
            let mut bad = p.clone();
            bad.cad.as_mut().unwrap().models[0].sha256 = "../../etc/passwd".into();
            assert!(save_ols(&bad, None, &[file(STEP)]).is_err());
        }

        /// Rewrite one archive entry, keeping everything else.
        fn tamper(ols: &[u8], target: &str, replacement: Option<&[u8]>) -> Vec<u8> {
            let mut src = zip::ZipArchive::new(Cursor::new(ols)).unwrap();
            let mut buf = Cursor::new(Vec::new());
            {
                let mut out = zip::ZipWriter::new(&mut buf);
                for i in 0..src.len() {
                    let mut f = src.by_index(i).unwrap();
                    let name = f.name().unwrap().to_string();
                    let mut data = Vec::new();
                    f.read_to_end(&mut data).unwrap();
                    if name == target {
                        match replacement {
                            Some(r) => data = r.to_vec(),
                            None => continue,
                        }
                    }
                    out.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
                    out.write_all(&data).unwrap();
                }
                out.finish().unwrap();
            }
            buf.into_inner()
        }

        #[test]
        fn corrupt_or_missing_cad_file_is_a_recoverable_warning() {
            let p = project_with(STEP);
            let ols = save_ols(&p, None, &[file(STEP)]).unwrap();
            let path = format!("cad/{}.step", sha256_hex(STEP));

            let corrupt = tamper(&ols, &path, Some(b"ISO-10303-21; tampered"));
            let loaded = load_ols(&corrupt).unwrap();
            assert!(loaded.cad_files.is_empty());
            assert_eq!(loaded.warnings.len(), 1);
            assert!(loaded.warnings[0].contains("checksum"), "{}", loaded.warnings[0]);
            // The project (including the model reference and measurements) still opens.
            assert_eq!(loaded.project.cad.unwrap().models.len(), 1);

            let missing = tamper(&ols, &path, None);
            let loaded = load_ols(&missing).unwrap();
            assert!(loaded.cad_files.is_empty());
            assert!(loaded.warnings[0].contains("missing"), "{}", loaded.warnings[0]);
        }
    }
}
