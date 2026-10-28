//! Project document model and the `.ols` file format.
//!
//! The JSON shape of [`Project`] is the contract shared with the desktop app
//! (`packages/shared-types/src/document.ts`). Field names are camelCase.

pub mod cad;
pub mod container;
pub mod import;
pub mod model;
pub mod sample;

pub use cad::CadWorkspace;
pub use container::{CadFile, LoadedOls, OLS_FORMAT, OLS_SCHEMA_VERSION, load_ols, migrate, save_ols};
pub use import::{decode_data_url_gray, import_svg, text_to_path};
pub use model::*;
