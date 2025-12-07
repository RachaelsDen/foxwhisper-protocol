use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json;
use std::error::Error;
use std::fs;
use std::path::PathBuf;

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn root_path(relative: &str) -> PathBuf {
    let mut path = repo_root();
    path.push(relative);
    path
}

pub fn load_json<T: DeserializeOwned>(relative: &str) -> Result<T, Box<dyn Error>> {
    let path = root_path(relative);
    let data = fs::read_to_string(path)?;
    let parsed = serde_json::from_str::<T>(&data)?;
    Ok(parsed)
}

pub fn write_json<T: Serialize>(filename: &str, payload: &T) -> Result<(), Box<dyn Error>> {
    let mut dir = repo_root();
    dir.push("results");
    fs::create_dir_all(&dir)?;
    let mut file_path = dir;
    file_path.push(filename);
    let data = serde_json::to_string_pretty(payload)?;
    fs::write(file_path, data)?;
    Ok(())
}
