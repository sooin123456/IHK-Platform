use ifc_derivative::{derive_artifacts, Limits};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

const SOURCE_FILE_ID: &str = "20000000-0000-4000-8000-000000000003";
static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct Glb {
    json: Value,
    binary: Vec<u8>,
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn temp_directory(label: &str) -> PathBuf {
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!(
        "1hk-ifc-derivative-{label}-{}-{sequence}",
        std::process::id()
    ));
    fs::create_dir(&directory).expect("create test directory");
    directory
}

fn run(source: &Path, manifest: &Path, geometry: &Path, source_file_id: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ifc-derivative"))
        .arg(source)
        .arg(manifest)
        .arg(geometry)
        .arg("--source-file-id")
        .arg(source_file_id)
        .output()
        .expect("run ifc-derivative")
}

fn server_canonical_json(bytes: &[u8], label: &str) -> Vec<u8> {
    let directory = temp_directory(label);
    let input = directory.join("manifest.json");
    fs::write(&input, bytes).expect("write manifest for Node canonicalization");
    let script = r#"
const fs = require("node:fs");
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("invalid JSON value");
  return serialized;
}
process.stdout.write(canonical(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))));
"#;
    let output = Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(input)
        .output()
        .expect("run Node canonicalizer");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("u32 bytes"))
}

fn parse_glb(bytes: &[u8]) -> Glb {
    assert_eq!(&bytes[0..4], b"glTF");
    assert_eq!(u32_le(bytes, 4), 2);
    assert_eq!(u32_le(bytes, 8) as usize, bytes.len());
    let mut offset = 12;
    let mut json = None;
    let mut binary = None;
    while offset < bytes.len() {
        let length = u32_le(bytes, offset) as usize;
        let kind = u32_le(bytes, offset + 4);
        offset += 8;
        let chunk = &bytes[offset..offset + length];
        match kind {
            0x4e4f534a => {
                let source = std::str::from_utf8(chunk)
                    .expect("GLB JSON UTF-8")
                    .trim_end_matches(' ');
                json = Some(serde_json::from_str(source).expect("GLB JSON"));
            }
            0x004e4942 => binary = Some(chunk.to_vec()),
            other => panic!("unexpected GLB chunk {other:#x}"),
        }
        offset += length;
    }
    assert_eq!(offset, bytes.len());
    Glb {
        json: json.expect("JSON chunk"),
        binary: binary.expect("embedded BIN chunk"),
    }
}

fn accessor_offset(document: &Value, accessor_index: usize) -> usize {
    let accessor = &document["accessors"][accessor_index];
    let view_index = accessor["bufferView"].as_u64().expect("bufferView") as usize;
    let view = &document["bufferViews"][view_index];
    view["byteOffset"].as_u64().unwrap_or(0) as usize
        + accessor["byteOffset"].as_u64().unwrap_or(0) as usize
}

fn primitive_positions(glb: &Glb, mesh_index: usize) -> Vec<f32> {
    let primitive = &glb.json["meshes"][mesh_index]["primitives"][0];
    let accessor_index = primitive["attributes"]["POSITION"]
        .as_u64()
        .expect("POSITION accessor") as usize;
    let accessor = &glb.json["accessors"][accessor_index];
    assert_eq!(accessor["componentType"], 5126);
    assert_eq!(accessor["type"], "VEC3");
    let count = accessor["count"].as_u64().expect("position count") as usize * 3;
    let offset = accessor_offset(&glb.json, accessor_index);
    (0..count)
        .map(|index| {
            let start = offset + index * 4;
            f32::from_le_bytes(
                glb.binary[start..start + 4]
                    .try_into()
                    .expect("position bytes"),
            )
        })
        .collect()
}

fn primitive_indices(glb: &Glb, mesh_index: usize) -> Vec<u32> {
    let primitive = &glb.json["meshes"][mesh_index]["primitives"][0];
    let accessor_index = primitive["indices"].as_u64().expect("index accessor") as usize;
    let accessor = &glb.json["accessors"][accessor_index];
    assert_eq!(accessor["componentType"], 5125);
    assert_eq!(accessor["type"], "SCALAR");
    let count = accessor["count"].as_u64().expect("index count") as usize;
    let offset = accessor_offset(&glb.json, accessor_index);
    (0..count)
        .map(|index| u32_le(&glb.binary, offset + index * 4))
        .collect()
}

#[test]
fn cli_emits_the_exact_platform_manifest_and_deterministic_embedded_glb() {
    let source = fixture("supported-triangulated.ifc");
    let source_before = fs::read(&source).expect("source fixture");
    let first = temp_directory("deterministic-a");
    let second = temp_directory("deterministic-b");
    let first_manifest = first.join("manifest.json");
    let first_geometry = first.join("geometry.glb");
    let second_manifest = second.join("manifest.json");
    let second_geometry = second.join("geometry.glb");

    let result = run(&source, &first_manifest, &first_geometry, SOURCE_FILE_ID);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let repeat = run(&source, &second_manifest, &second_geometry, SOURCE_FILE_ID);
    assert!(
        repeat.status.success(),
        "{}",
        String::from_utf8_lossy(&repeat.stderr)
    );

    let manifest = fs::read(&first_manifest).expect("manifest");
    let geometry = fs::read(&first_geometry).expect("geometry");
    assert_eq!(
        manifest,
        fs::read(second_manifest).expect("repeat manifest")
    );
    assert_eq!(
        geometry,
        fs::read(second_geometry).expect("repeat geometry")
    );
    assert_eq!(fs::read(&source).expect("source after"), source_before);

    let expected_manifest = format!(
        "{{\"elements\":[{{\"expressId\":1,\"globalId\":\"1HK_TEST_ELEMENT_00001\",\"meshes\":[{{\"nodeId\":\"ifc-1\",\"primitiveIndices\":[0]}}],\"name\":\"Triangle\",\"properties\":[{{\"group\":\"Pset_1HK\",\"name\":\"FireRating\",\"value\":\"2h\"}}],\"typeName\":\"IFCWALL\"}}],\"geometry\":{{\"sha256\":\"{}\"}},\"schemaVersion\":1,\"source\":{{\"fileId\":\"{}\",\"sha256\":\"{}\"}}}}",
        sha256(&geometry),
        SOURCE_FILE_ID,
        sha256(&source_before),
    );
    assert_eq!(manifest, expected_manifest.as_bytes());

    let glb = parse_glb(&geometry);
    assert_eq!(glb.json["asset"]["version"], "2.0");
    assert_eq!(glb.json["buffers"].as_array().expect("buffers").len(), 1);
    assert!(glb.json["buffers"][0].get("uri").is_none());
    assert_eq!(glb.json["nodes"].as_array().expect("nodes").len(), 1);
    assert_eq!(glb.json["meshes"].as_array().expect("meshes").len(), 1);
    assert_eq!(
        glb.json["nodes"][0]["extras"],
        serde_json::json!({"ifcExpressId": 1, "ifcNodeId": "ifc-1"})
    );
    assert_eq!(
        glb.json["nodes"][0]["matrix"],
        serde_json::json!([
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 20.0, 30.0, 1.0
        ])
    );
    assert_eq!(
        primitive_positions(&glb, 0),
        vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    );
    assert_eq!(primitive_indices(&glb, 0), vec![0, 1, 2]);
}

#[test]
fn millimetre_model_geometry_and_placement_are_normalized_to_metres() {
    let directory = temp_directory("millimetres");
    let manifest = directory.join("manifest.json");
    let geometry = directory.join("geometry.glb");
    let result = run(
        &fixture("millimetre-triangulated.ifc"),
        &manifest,
        &geometry,
        SOURCE_FILE_ID,
    );
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let glb = parse_glb(&fs::read(geometry).expect("geometry"));
    assert_eq!(
        primitive_positions(&glb, 0),
        vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    );
    assert_eq!(
        glb.json["nodes"][0]["matrix"],
        serde_json::json!([
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 20.0, 30.0, 1.0
        ])
    );
}

#[test]
fn mapped_geometric_set_window_is_preserved_as_deterministic_lines_in_metres() {
    let source = fixture("mapped-geometric-set.ifc");
    let source_before = fs::read(&source).expect("source fixture");
    let first = temp_directory("mapped-lines-a");
    let second = temp_directory("mapped-lines-b");
    let first_manifest = first.join("manifest.json");
    let first_geometry = first.join("geometry.glb");
    let second_manifest = second.join("manifest.json");
    let second_geometry = second.join("geometry.glb");

    let result = run(&source, &first_manifest, &first_geometry, SOURCE_FILE_ID);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let repeat = run(&source, &second_manifest, &second_geometry, SOURCE_FILE_ID);
    assert!(
        repeat.status.success(),
        "{}",
        String::from_utf8_lossy(&repeat.stderr)
    );

    let manifest_bytes = fs::read(&first_manifest).expect("manifest");
    let geometry_bytes = fs::read(&first_geometry).expect("geometry");
    assert_eq!(
        manifest_bytes,
        fs::read(second_manifest).expect("repeat manifest")
    );
    assert_eq!(
        geometry_bytes,
        fs::read(second_geometry).expect("repeat geometry")
    );
    assert_eq!(fs::read(&source).expect("source after"), source_before);

    let manifest: Value = serde_json::from_slice(&manifest_bytes).expect("manifest JSON");
    assert_eq!(
        manifest["elements"],
        serde_json::json!([{
            "expressId": 1,
            "globalId": "1HK_MAPPED_WINDOW_0001",
            "meshes": [{"nodeId": "ifc-1", "primitiveIndices": [0]}],
            "name": "Mapped Footprint Window",
            "properties": [],
            "typeName": "IFCWINDOW"
        }])
    );
    assert_eq!(manifest["source"]["sha256"], sha256(&source_before));
    assert_eq!(manifest["geometry"]["sha256"], sha256(&geometry_bytes));

    let glb = parse_glb(&geometry_bytes);
    assert_eq!(glb.json["meshes"][0]["primitives"][0]["mode"], 1);
    assert_eq!(
        glb.json["nodes"][0]["matrix"],
        serde_json::json!([
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 20.0, 30.0, 1.0
        ])
    );
    assert_eq!(
        primitive_positions(&glb, 0),
        vec![
            0.5, 0.7, 0.9, 1.5, 0.7, 0.9, 1.5, 1.2, 0.9, 2.5, 0.7, 0.9, 2.5, 1.2, 0.9, 3.5, 0.7,
            0.9, 3.5, 1.2, 0.9, 4.5, 0.7, 0.9, 4.5, 1.2, 0.9, 5.0, 1.2, 0.9,
        ]
    );
    assert_eq!(
        primitive_indices(&glb, 0),
        vec![0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9]
    );
}

#[test]
fn mapped_geometric_set_fallback_rejects_non_schema_extra_arguments() {
    let fixture =
        String::from_utf8(fs::read(fixture("mapped-geometric-set.ifc")).expect("source fixture"))
            .expect("UTF-8 fixture");
    for (label, valid, invalid) in [
        (
            "product definition shape",
            "#5=IFCPRODUCTDEFINITIONSHAPE($,$,(#6));",
            "#5=IFCPRODUCTDEFINITIONSHAPE($,$,(#6),$);",
        ),
        (
            "outer shape representation",
            "#6=IFCSHAPEREPRESENTATION($,'FootPrint','MappedRepresentation',(#7));",
            "#6=IFCSHAPEREPRESENTATION($,'FootPrint','MappedRepresentation',(#7),$);",
        ),
        (
            "mapped item",
            "#7=IFCMAPPEDITEM(#8,#11);",
            "#7=IFCMAPPEDITEM(#8,#11,$);",
        ),
        (
            "representation map",
            "#8=IFCREPRESENTATIONMAP(#9,#12);",
            "#8=IFCREPRESENTATIONMAP(#9,#12,$);",
        ),
        (
            "inner shape representation",
            "#12=IFCSHAPEREPRESENTATION($,'FootPrint','GeometricSet',(#13));",
            "#12=IFCSHAPEREPRESENTATION($,'FootPrint','GeometricSet',(#13),$);",
        ),
        (
            "geometric set",
            "#13=IFCGEOMETRICSET((#14,#15,#16,#17));",
            "#13=IFCGEOMETRICSET((#14,#15,#16,#17),$);",
        ),
        (
            "polyline",
            "#14=IFCPOLYLINE((#20,#21,#22));",
            "#14=IFCPOLYLINE((#20,#21,#22),$);",
        ),
        (
            "cartesian point",
            "#20=IFCCARTESIANPOINT((0.,0.,0.));",
            "#20=IFCCARTESIANPOINT((0.,0.,0.),$);",
        ),
    ] {
        let source = fixture.replacen(valid, invalid, 1);
        assert_ne!(source, fixture, "{label}: fixture mutation");
        assert!(
            derive_artifacts(source.as_bytes(), SOURCE_FILE_ID, &Limits::default()).is_err(),
            "{label}: non-schema extra arguments must fail closed"
        );
    }
}

#[test]
fn mapped_geometric_set_fails_before_adaptation_when_budget_is_exhausted() {
    let source = fs::read(fixture("mapped-geometric-set.ifc")).expect("source fixture");
    for (label, limits, expected) in [
        (
            "vertices",
            Limits {
                max_vertices: 2,
                ..Limits::default()
            },
            "vertices limit",
        ),
        (
            "indices",
            Limits {
                max_indices: 2,
                ..Limits::default()
            },
            "indices limit",
        ),
    ] {
        let error = derive_artifacts(&source, SOURCE_FILE_ID, &limits)
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected), "{label}: {error}");
        assert!(
            error.contains("before geometry adaptation"),
            "{label}: {error}"
        );
    }
}

#[test]
fn malformed_or_unsupported_ifc_leaves_both_targets_absent() {
    for name in ["unsupported-geometry.ifc", "malformed.ifc"] {
        let directory = temp_directory(name);
        let manifest = directory.join("manifest.json");
        let geometry = directory.join("geometry.glb");
        let result = run(&fixture(name), &manifest, &geometry, SOURCE_FILE_ID);
        assert!(!result.status.success(), "{name} unexpectedly succeeded");
        assert!(!manifest.exists(), "{name} left a manifest");
        assert!(!geometry.exists(), "{name} left geometry");
    }
}

#[test]
fn invalid_source_file_id_leaves_both_targets_absent() {
    let directory = temp_directory("invalid-uuid");
    let manifest = directory.join("manifest.json");
    let geometry = directory.join("geometry.glb");
    let result = run(
        &fixture("supported-triangulated.ifc"),
        &manifest,
        &geometry,
        "not-a-uuid",
    );
    assert!(!result.status.success());
    assert!(!manifest.exists());
    assert!(!geometry.exists());
}

#[test]
fn refuses_to_overwrite_either_existing_target() {
    let source = fixture("supported-triangulated.ifc");

    let first = temp_directory("existing-manifest");
    let manifest = first.join("manifest.json");
    let geometry = first.join("geometry.glb");
    fs::write(&manifest, b"keep manifest").expect("seed manifest");
    let result = run(&source, &manifest, &geometry, SOURCE_FILE_ID);
    assert!(!result.status.success());
    assert_eq!(
        fs::read(&manifest).expect("manifest remains"),
        b"keep manifest"
    );
    assert!(!geometry.exists());

    let second = temp_directory("existing-geometry");
    let manifest = second.join("manifest.json");
    let geometry = second.join("geometry.glb");
    fs::write(&geometry, b"keep geometry").expect("seed geometry");
    let result = run(&source, &manifest, &geometry, SOURCE_FILE_ID);
    assert!(!result.status.success());
    assert!(!manifest.exists());
    assert_eq!(
        fs::read(&geometry).expect("geometry remains"),
        b"keep geometry"
    );
}

#[test]
fn configured_manifest_and_glb_output_limits_fail_closed() {
    let source = fs::read(fixture("supported-triangulated.ifc")).expect("source fixture");
    let geometry_error = derive_artifacts(
        &source,
        SOURCE_FILE_ID,
        &Limits {
            max_geometry_bytes: 1,
            ..Limits::default()
        },
    )
    .unwrap_err()
    .to_string();
    assert!(
        geometry_error.contains("geometry limit"),
        "{geometry_error}"
    );

    let manifest_error = derive_artifacts(
        &source,
        SOURCE_FILE_ID,
        &Limits {
            max_manifest_bytes: 1,
            ..Limits::default()
        },
    )
    .unwrap_err()
    .to_string();
    assert!(
        manifest_error.contains("manifest limit"),
        "{manifest_error}"
    );
}

#[test]
fn f32_coordinate_overflow_leaves_both_targets_absent() {
    let directory = temp_directory("f32-overflow");
    let manifest = directory.join("manifest.json");
    let geometry = directory.join("geometry.glb");
    let result = run(
        &fixture("overflow-coordinate.ifc"),
        &manifest,
        &geometry,
        SOURCE_FILE_ID,
    );
    assert!(!result.status.success());
    assert!(!manifest.exists());
    assert!(!geometry.exists());
}

#[test]
fn platform_boundary_rejects_a_project_without_a_resolvable_length_unit() {
    let directory = temp_directory("missing-unit");
    let manifest = directory.join("manifest.json");
    let geometry = directory.join("geometry.glb");
    let result = run(
        &fixture("missing-length-unit.ifc"),
        &manifest,
        &geometry,
        SOURCE_FILE_ID,
    );
    assert!(!result.status.success());
    assert!(!manifest.exists());
    assert!(!geometry.exists());
}

#[test]
fn platform_boundary_counts_string_limits_as_utf16_code_units() {
    let source =
        String::from_utf8(fs::read(fixture("supported-triangulated.ifc")).expect("source fixture"))
            .expect("UTF-8 fixture")
            .replace("'Triangle'", &format!("'{}'", "😀".repeat(251)));
    let error = derive_artifacts(source.as_bytes(), SOURCE_FILE_ID, &Limits::default())
        .unwrap_err()
        .to_string();
    assert!(error.contains("name"), "{error}");
}

#[test]
fn platform_boundary_accepts_the_generic_uuid_shape_zod_accepts() {
    let source = fs::read(fixture("supported-triangulated.ifc")).expect("source fixture");
    let nil_uuid = "00000000-0000-0000-0000-000000000000";
    let artifacts =
        derive_artifacts(&source, nil_uuid, &Limits::default()).expect("generic UUID shape");
    let manifest: Value = serde_json::from_slice(&artifacts.manifest).expect("manifest JSON");
    assert_eq!(manifest["source"]["fileId"], nil_uuid);
}

#[test]
fn platform_boundary_rejects_property_integers_that_json_cannot_round_trip() {
    let source =
        String::from_utf8(fs::read(fixture("supported-triangulated.ifc")).expect("source fixture"))
            .expect("UTF-8 fixture")
            .replace("IFCLABEL('2h')", "IFCINTEGER(9007199254740993)");
    let error = derive_artifacts(source.as_bytes(), SOURCE_FILE_ID, &Limits::default())
        .unwrap_err()
        .to_string();
    assert!(error.contains("safe integer"), "{error}");
}

#[test]
fn integral_real_properties_match_server_canonical_json_numbers() {
    let source =
        String::from_utf8(fs::read(fixture("supported-triangulated.ifc")).expect("source fixture"))
            .expect("UTF-8 fixture")
            .replace("IFCLABEL('2h')", "IFCLENGTHMEASURE(0.)");
    let artifacts = derive_artifacts(source.as_bytes(), SOURCE_FILE_ID, &Limits::default())
        .expect("numeric property derivative");
    let expected_manifest = format!(
        "{{\"elements\":[{{\"expressId\":1,\"globalId\":\"1HK_TEST_ELEMENT_00001\",\"meshes\":[{{\"nodeId\":\"ifc-1\",\"primitiveIndices\":[0]}}],\"name\":\"Triangle\",\"properties\":[{{\"group\":\"Pset_1HK\",\"name\":\"FireRating\",\"value\":0}}],\"typeName\":\"IFCWALL\"}}],\"geometry\":{{\"sha256\":\"{}\"}},\"schemaVersion\":1,\"source\":{{\"fileId\":\"{}\",\"sha256\":\"{}\"}}}}",
        sha256(&artifacts.geometry),
        SOURCE_FILE_ID,
        sha256(source.as_bytes()),
    );
    assert_eq!(artifacts.manifest, expected_manifest.as_bytes());
}

#[test]
fn numeric_properties_match_javascript_json_stringify_at_notation_boundaries() {
    let mut mismatches = Vec::new();
    for (label, ifc_number, expected_json) in [
        ("fixed-lower-boundary", "0.000001", "0.000001"),
        (
            "fixed-large-integral-real",
            "10000000000000000.",
            "10000000000000000",
        ),
    ] {
        let source = String::from_utf8(
            fs::read(fixture("supported-triangulated.ifc")).expect("source fixture"),
        )
        .expect("UTF-8 fixture")
        .replace("IFCLABEL('2h')", &format!("IFCLENGTHMEASURE({ifc_number})"));
        let artifacts = derive_artifacts(source.as_bytes(), SOURCE_FILE_ID, &Limits::default())
            .expect("numeric property derivative");
        let server_bytes = server_canonical_json(&artifacts.manifest, label);
        let server_text = std::str::from_utf8(&server_bytes).expect("server canonical UTF-8");

        assert!(
            server_text.contains(&format!("\"value\":{expected_json}")),
            "{label}: {server_text}"
        );
        if artifacts.manifest != server_bytes {
            mismatches.push(label);
        }
    }
    assert!(
        mismatches.is_empty(),
        "canonical mismatches: {mismatches:?}"
    );
}
