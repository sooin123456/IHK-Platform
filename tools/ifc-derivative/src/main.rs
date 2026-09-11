use ifc_derivative::{write_derivative, Limits};
use std::{env, fs, path::PathBuf, process};

const USAGE: &str =
    "usage: ifc-derivative SOURCE.ifc MANIFEST.json GEOMETRY.glb --source-file-id UUID";

fn main() {
    if let Err(error) = run() {
        eprintln!("ifc-derivative: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let source = PathBuf::from(args.next().ok_or(USAGE)?);
    let manifest = PathBuf::from(args.next().ok_or(USAGE)?);
    let geometry = PathBuf::from(args.next().ok_or(USAGE)?);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--source-file-id")) {
        return Err(USAGE.into());
    }
    let source_file_id = args
        .next()
        .ok_or(USAGE)?
        .into_string()
        .map_err(|_| "source file id must be UTF-8")?;
    if args.next().is_some() {
        return Err(USAGE.into());
    }
    let input = fs::read(source)?;
    write_derivative(
        &input,
        &source_file_id,
        &manifest,
        &geometry,
        &Limits::default(),
    )?;
    Ok(())
}
