use oxideav_ifc::{
    length_unit_scale, mesh_from_product_shape, parse_step_with_limits, placement_transform,
    GeometryError, IfcValue, Model, ParsedInstance, Property, PropertyValue, StepFile, StepLimits,
    Transform, Value as StepValue,
};
use serde_json::{Number, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fmt, fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};

pub const ENGINE_COMMIT: &str = "b6dce78735558c631950fc6a700440855ceb9953";
pub const MAX_MANIFEST_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_GEOMETRY_BYTES: usize = 200 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
pub struct Limits {
    pub max_input_bytes: usize,
    pub max_instances: usize,
    pub max_depth: usize,
    pub max_string_bytes: usize,
    pub max_vertices: usize,
    pub max_indices: usize,
    pub max_manifest_bytes: usize,
    pub max_geometry_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * 1024 * 1024,
            max_instances: 8_000_000,
            max_depth: 64,
            max_string_bytes: 16 * 1024 * 1024,
            max_vertices: 10_000_000,
            max_indices: 60_000_000,
            max_manifest_bytes: MAX_MANIFEST_BYTES,
            max_geometry_bytes: MAX_GEOMETRY_BYTES,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Artifacts {
    pub manifest: Vec<u8>,
    pub geometry: Vec<u8>,
}

#[derive(Debug)]
pub struct DerivativeError(String);

impl fmt::Display for DerivativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DerivativeError {}

struct Element {
    express_id: u64,
    global_id: String,
    type_name: String,
    name: Option<String>,
    properties: Vec<PropertyEntry>,
    node_id: String,
}

struct PropertyEntry {
    group: String,
    name: String,
    value: Value,
}

struct Mesh {
    express_id: u64,
    node_id: String,
    positions: Vec<[f32; 3]>,
    indices: Vec<u32>,
    mode: u8,
    transform: [f32; 16],
}

struct ProductGeometry {
    positions: Vec<[f64; 3]>,
    indices: Vec<u32>,
    mode: u8,
}

pub fn derive_artifacts(
    input: &[u8],
    source_file_id: &str,
    limits: &Limits,
) -> Result<Artifacts, DerivativeError> {
    validate_uuid(source_file_id)?;
    let step_limits = StepLimits {
        max_input_len: limits.max_input_bytes,
        max_instances: limits.max_instances,
        max_depth: limits.max_depth,
        max_string_len: limits.max_string_bytes,
    };
    let step = parse_step_with_limits(input, &step_limits)
        .map_err(|error| DerivativeError(format!("IFC parse/limit failure: {error}")))?;
    if !step.dangling_references().is_empty() {
        return Err(DerivativeError(
            "IFC parse graph has dangling references".into(),
        ));
    }
    let unit_scale = match length_unit_scale(&step) {
        Some(scale) => scale,
        None if step
            .instances
            .values()
            .any(|item| item.keyword == "IFCPROJECT") =>
        {
            return Err(DerivativeError(
                "IFC project has no resolvable length unit".into(),
            ))
        }
        None => 1.0,
    };
    if !unit_scale.is_finite() || unit_scale <= 0.0 {
        return Err(DerivativeError("invalid IFC length unit scale".into()));
    }

    let model = Model::from_step(&step);
    let mut products = model.products().collect::<Vec<_>>();
    products.sort_by_key(|product| product.id());
    let mut elements = Vec::new();
    let mut meshes = Vec::new();
    let mut vertices = 0usize;
    let mut indices = 0usize;
    let mut global_ids = HashSet::new();

    for product in products {
        let Some(representation_id) = product.representation() else {
            continue;
        };
        let geometry = product_geometry(
            &step,
            representation_id,
            limits.max_vertices.saturating_sub(vertices),
            limits.max_indices.saturating_sub(indices),
        )
        .map_err(|error| {
            DerivativeError(format!(
                "status=failed unsupported geometry for product #{}: {error}",
                product.id()
            ))
        })?;
        if geometry.positions.is_empty() || geometry.indices.is_empty() {
            return Err(DerivativeError(format!(
                "status=failed empty geometry for product #{}",
                product.id()
            )));
        }
        if product.id() > MAX_SAFE_INTEGER {
            return Err(DerivativeError(
                "IFC express id exceeds the platform safe integer limit".into(),
            ));
        }
        vertices = vertices
            .checked_add(geometry.positions.len())
            .ok_or_else(|| DerivativeError("vertices limit overflow".into()))?;
        indices = indices
            .checked_add(geometry.indices.len())
            .ok_or_else(|| DerivativeError("indices limit overflow".into()))?;
        if vertices > limits.max_vertices {
            return Err(DerivativeError(format!(
                "vertices limit exceeded: {vertices} > {}",
                limits.max_vertices
            )));
        }
        if indices > limits.max_indices {
            return Err(DerivativeError(format!(
                "indices limit exceeded: {indices} > {}",
                limits.max_indices
            )));
        }

        let global_id = product
            .global_id()
            .ok_or_else(|| DerivativeError(format!("product #{} has no GlobalId", product.id())))?;
        validate_global_id(global_id)?;
        if !global_ids.insert(global_id.to_string()) {
            return Err(DerivativeError(format!(
                "duplicate IFC GlobalId {global_id}"
            )));
        }
        let type_name = platform_trimmed(product.keyword(), 160, "IFC type name")?;
        let name = product
            .name()
            .map(|name| platform_string(name, 500, "IFC product name"))
            .transpose()?;
        let mut properties = properties_for_product(&model, product.id())?;
        properties
            .sort_by(|left, right| (&left.group, &left.name).cmp(&(&right.group, &right.name)));
        if properties.len() > 10_000 {
            return Err(DerivativeError(format!(
                "product #{} exceeds the platform property limit",
                product.id()
            )));
        }
        let transform = match product.object_placement() {
            Some(id) => placement_transform(&step, id).map_err(|error| {
                DerivativeError(format!(
                    "invalid placement for product #{}: {error}",
                    product.id()
                ))
            })?,
            None => Transform::IDENTITY,
        };
        let node_id = format!("ifc-{}", product.id());
        let positions = geometry
            .positions
            .into_iter()
            .map(|position| {
                Ok([
                    scaled_f32(position[0], unit_scale)?,
                    scaled_f32(position[1], unit_scale)?,
                    scaled_f32(position[2], unit_scale)?,
                ])
            })
            .collect::<Result<Vec<_>, DerivativeError>>()?;
        let mesh_indices = geometry.indices;
        if mesh_indices
            .iter()
            .any(|index| *index as usize >= positions.len())
        {
            return Err(DerivativeError(
                "IFC geometry index exceeds the position buffer".into(),
            ));
        }
        meshes.push(Mesh {
            express_id: product.id(),
            node_id: node_id.clone(),
            positions,
            indices: mesh_indices,
            mode: geometry.mode,
            transform: transform_array(transform, unit_scale)?,
        });
        elements.push(Element {
            express_id: product.id(),
            global_id: global_id.to_string(),
            type_name,
            name,
            properties,
            node_id,
        });
    }
    if elements.len() > 1_000_000 {
        return Err(DerivativeError(
            "IFC derivative exceeds the platform element limit".into(),
        ));
    }

    let geometry = build_glb(&meshes, limits.max_geometry_bytes)?;
    let manifest_value = Value::Object(
        [
            ("schemaVersion".into(), Value::Number(Number::from(1_u64))),
            (
                "source".into(),
                serde_json::json!({
                    "fileId": source_file_id,
                    "sha256": sha256(input),
                }),
            ),
            (
                "geometry".into(),
                serde_json::json!({ "sha256": sha256(&geometry) }),
            ),
            (
                "elements".into(),
                Value::Array(elements.iter().map(element_json).collect()),
            ),
        ]
        .into_iter()
        .collect(),
    );
    let manifest = platform_canonical_json(&manifest_value)?;
    if manifest.len() > limits.max_manifest_bytes {
        return Err(DerivativeError(format!(
            "manifest limit exceeded: {} > {}",
            manifest.len(),
            limits.max_manifest_bytes
        )));
    }
    Ok(Artifacts { manifest, geometry })
}

fn product_geometry(
    step: &StepFile,
    representation_id: u64,
    max_vertices: usize,
    max_indices: usize,
) -> Result<ProductGeometry, String> {
    let original_error = match mesh_from_product_shape(step, representation_id) {
        Ok(mesh) => {
            if mesh.positions.len() > max_vertices {
                return Err(format!(
                    "vertices limit exceeded before geometry allocation: {} > {max_vertices}",
                    mesh.positions.len()
                ));
            }
            let index_count = mesh
                .triangles
                .len()
                .checked_mul(3)
                .ok_or_else(|| "indices limit overflow".to_string())?;
            if index_count > max_indices {
                return Err(format!(
                    "indices limit exceeded before geometry allocation: {index_count} > {max_indices}"
                ));
            }
            return Ok(ProductGeometry {
                positions: mesh.positions,
                indices: mesh.triangles.into_iter().flatten().collect(),
                mode: 4,
            });
        }
        Err(error) => error,
    };
    if !matches!(
        &original_error,
        GeometryError::Unsupported(keyword) if keyword == "IFCGEOMETRICSET"
    ) {
        return Err(original_error.to_string());
    }
    let Some((position_count, line_index_count)) =
        mapped_geometric_set_size(step, representation_id)
    else {
        return Err(original_error.to_string());
    };
    if position_count > max_vertices {
        return Err(format!(
            "vertices limit exceeded before geometry adaptation: {position_count} > {max_vertices}"
        ));
    }
    if line_index_count > max_indices {
        return Err(format!(
            "indices limit exceeded before geometry adaptation: {line_index_count} > {max_indices}"
        ));
    }
    let Some((adapted, segment_count)) = adapt_mapped_geometric_set(step, representation_id) else {
        return Err(original_error.to_string());
    };
    let mesh =
        mesh_from_product_shape(&adapted, representation_id).map_err(|error| error.to_string())?;
    if mesh.triangles.len() != segment_count
        || mesh
            .triangles
            .iter()
            .any(|[_, end, repeated]| end != repeated)
    {
        return Err("mapped IFC line adaptation produced unexpected topology".into());
    }
    Ok(ProductGeometry {
        positions: mesh.positions,
        indices: mesh
            .triangles
            .into_iter()
            .flat_map(|[start, end, _]| [start, end])
            .collect(),
        mode: 1,
    })
}

fn mapped_geometric_set_size(step: &StepFile, representation_id: u64) -> Option<(usize, usize)> {
    let set_id = mapped_geometric_set_id(step, representation_id)?;
    let set = step.get(set_id)?;
    let curves = set.args.first()?.as_list()?;
    if curves.is_empty() {
        return None;
    }
    let mut positions = 0usize;
    let mut segments = 0usize;
    for curve in curves {
        let polyline = step.get(curve.as_reference()?)?;
        if polyline.keyword != "IFCPOLYLINE" || polyline.args.len() != 1 {
            return None;
        }
        let points = polyline.args.first()?.as_list()?;
        if points.len() < 2 {
            return None;
        }
        for point in points {
            let point = step.get(point.as_reference()?)?;
            if point.keyword != "IFCCARTESIANPOINT" || point.args.len() != 1 {
                return None;
            }
            let coordinates = point.args.first()?.as_list()?;
            if !(2..=3).contains(&coordinates.len())
                || coordinates
                    .iter()
                    .any(|coordinate| !coordinate.as_number().is_some_and(f64::is_finite))
            {
                return None;
            }
        }
        positions = positions.checked_add(points.len())?;
        segments = segments.checked_add(points.len() - 1)?;
    }
    Some((positions, segments.checked_mul(2)?))
}

fn adapt_mapped_geometric_set(
    step: &StepFile,
    representation_id: u64,
) -> Option<(StepFile, usize)> {
    let set_id = mapped_geometric_set_id(step, representation_id)?;
    let set = step.get(set_id)?;
    let curves = set.args.first()?.as_list()?;
    if curves.is_empty() {
        return None;
    }

    let mut positions = Vec::new();
    let mut triangles = Vec::new();
    for curve in curves {
        let polyline = step.get(curve.as_reference()?)?;
        if polyline.keyword != "IFCPOLYLINE" || polyline.args.len() != 1 {
            return None;
        }
        let points = polyline.args.first()?.as_list()?;
        if points.len() < 2 {
            return None;
        }
        let mut previous = None;
        for point in points {
            let point = step.get(point.as_reference()?)?;
            if point.keyword != "IFCCARTESIANPOINT" || point.args.len() != 1 {
                return None;
            }
            let coordinates = point.args.first()?.as_list()?;
            if !(2..=3).contains(&coordinates.len()) {
                return None;
            }
            let x = coordinates[0].as_number()?;
            let y = coordinates[1].as_number()?;
            let z = coordinates
                .get(2)
                .map(StepValue::as_number)
                .unwrap_or(Some(0.0))?;
            if !x.is_finite() || !y.is_finite() || !z.is_finite() {
                return None;
            }
            positions.push(StepValue::List(vec![
                StepValue::Real(x),
                StepValue::Real(y),
                StepValue::Real(z),
            ]));
            let current = i64::try_from(positions.len()).ok()?;
            if let Some(previous) = previous {
                triangles.push(StepValue::List(vec![
                    StepValue::Integer(previous),
                    StepValue::Integer(current),
                    StepValue::Integer(current),
                ]));
            }
            previous = Some(current);
        }
    }
    u32::try_from(positions.len()).ok()?;

    let coordinates_id = step
        .instances
        .keys()
        .next_back()
        .copied()
        .unwrap_or(0)
        .checked_add(1)?;
    let segment_count = triangles.len();
    // ponytail: clone the parsed model per curve-only product; batch adaptations only if profiling shows this dominates conversion time or memory.
    let mut adapted = step.clone();
    adapted.instances.insert(
        coordinates_id,
        ParsedInstance {
            id: coordinates_id,
            keyword: "IFCCARTESIANPOINTLIST3D".into(),
            args: vec![StepValue::List(positions)],
        },
    );
    let set = adapted.instances.get_mut(&set_id)?;
    set.keyword = "IFCTRIANGULATEDFACESET".into();
    set.args = vec![
        StepValue::Reference(coordinates_id),
        StepValue::Unset,
        StepValue::Enum("F".into()),
        StepValue::List(triangles),
        StepValue::Unset,
    ];
    Some((adapted, segment_count))
}

fn mapped_geometric_set_id(step: &StepFile, representation_id: u64) -> Option<u64> {
    let product_shape = step.get(representation_id)?;
    if product_shape.keyword != "IFCPRODUCTDEFINITIONSHAPE" || product_shape.args.len() != 3 {
        return None;
    }
    let [outer] = product_shape.args.get(2)?.as_list()? else {
        return None;
    };
    let outer = step.get(outer.as_reference()?)?;
    if outer.keyword != "IFCSHAPEREPRESENTATION"
        || outer.args.len() != 4
        || !outer
            .args
            .get(1)
            .and_then(StepValue::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("FootPrint"))
        || !outer
            .args
            .get(2)
            .and_then(StepValue::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("MappedRepresentation"))
    {
        return None;
    }
    let [mapped] = outer.args.get(3)?.as_list()? else {
        return None;
    };
    let mapped = step.get(mapped.as_reference()?)?;
    if mapped.keyword != "IFCMAPPEDITEM" || mapped.args.len() != 2 {
        return None;
    }
    let representation_map = step.get(mapped.args.first()?.as_reference()?)?;
    if representation_map.keyword != "IFCREPRESENTATIONMAP" || representation_map.args.len() != 2 {
        return None;
    }
    let inner = step.get(representation_map.args.get(1)?.as_reference()?)?;
    if inner.keyword != "IFCSHAPEREPRESENTATION"
        || inner.args.len() != 4
        || !inner
            .args
            .get(1)
            .and_then(StepValue::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("FootPrint"))
        || !inner
            .args
            .get(2)
            .and_then(StepValue::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("GeometricSet"))
    {
        return None;
    }
    let [set] = inner.args.get(3)?.as_list()? else {
        return None;
    };
    let set_id = set.as_reference()?;
    let set = step.get(set_id)?;
    (set.keyword == "IFCGEOMETRICSET" && set.args.len() == 1).then_some(set_id)
}

pub fn write_derivative(
    input: &[u8],
    source_file_id: &str,
    manifest_target: &Path,
    geometry_target: &Path,
    limits: &Limits,
) -> Result<(), DerivativeError> {
    if manifest_target == geometry_target {
        return Err(DerivativeError(
            "manifest and geometry targets must differ".into(),
        ));
    }
    if manifest_target.exists() || geometry_target.exists() {
        return Err(DerivativeError(
            "refusing to overwrite an existing derivative target".into(),
        ));
    }
    let artifacts = derive_artifacts(input, source_file_id, limits)?;
    write_pair_without_clobber(
        manifest_target,
        &artifacts.manifest,
        geometry_target,
        &artifacts.geometry,
    )
}

fn properties_for_product(
    model: &Model<'_>,
    product_id: u64,
) -> Result<Vec<PropertyEntry>, DerivativeError> {
    let mut output = Vec::new();
    for set in model.property_sets(product_id) {
        let group = platform_trimmed(set.name.unwrap_or("<unnamed>"), 160, "property group")?;
        for property in &set.properties {
            let Some(name) = property.name else {
                continue;
            };
            let Some(value) = property_scalar(property)? else {
                continue;
            };
            let name = platform_trimmed(name, 160, "property name")?;
            if let Value::String(text) = &value {
                platform_string(text, 4_000, "property value")?;
            }
            output.push(PropertyEntry {
                group: group.clone(),
                name,
                value,
            });
        }
    }
    Ok(output)
}

fn property_scalar(property: &Property<'_>) -> Result<Option<Value>, DerivativeError> {
    match &property.value {
        PropertyValue::Single { value, .. } => value.as_ref().map(ifc_value_json).transpose(),
        _ => Ok(None),
    }
}

fn ifc_value_json(value: &IfcValue<'_>) -> Result<Value, DerivativeError> {
    if let Some(text) = value.as_str().or_else(|| value.as_enum()) {
        return Ok(Value::String(text.to_string()));
    }
    if let Some(boolean) = value.as_bool() {
        return Ok(Value::Bool(boolean));
    }
    if let Some(integer) = value.as_integer() {
        if integer.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err(DerivativeError(
                "property integer exceeds the platform safe integer limit".into(),
            ));
        }
        return Ok(Value::Number(integer.into()));
    }
    if let Some(number) = value.as_number() {
        if !number.is_finite() {
            return Err(DerivativeError("non-finite property number".into()));
        }
        if number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER as f64 {
            return Ok(Value::Number((number as i64).into()));
        }
        return Number::from_f64(number)
            .map(Value::Number)
            .ok_or_else(|| DerivativeError("non-finite property number".into()));
    }
    Ok(Value::String(format!("{:?}", value.raw())))
}

fn element_json(element: &Element) -> Value {
    serde_json::json!({
        "expressId": element.express_id,
        "globalId": element.global_id,
        "meshes": [{
            "nodeId": element.node_id,
            "primitiveIndices": [0],
        }],
        "name": element.name,
        "properties": element.properties.iter().map(|property| serde_json::json!({
            "group": property.group,
            "name": property.name,
            "value": property.value,
        })).collect::<Vec<_>>(),
        "typeName": element.type_name,
    })
}

fn build_glb(meshes: &[Mesh], maximum_bytes: usize) -> Result<Vec<u8>, DerivativeError> {
    let mut binary = Vec::new();
    let mut buffer_views = Vec::new();
    let mut accessors = Vec::new();
    let mut gltf_meshes = Vec::new();
    let mut nodes = Vec::new();

    for mesh in meshes {
        let added_binary_bytes = mesh
            .positions
            .len()
            .checked_mul(12)
            .and_then(|length| {
                mesh.indices
                    .len()
                    .checked_mul(4)
                    .and_then(|indices| length.checked_add(indices))
            })
            .and_then(|length| length.checked_add(binary.len()))
            .ok_or_else(|| DerivativeError("GLB size overflow".into()))?;
        if added_binary_bytes > maximum_bytes {
            return Err(DerivativeError(format!(
                "geometry limit exceeded: binary payload > {maximum_bytes}"
            )));
        }
        let position_offset = binary.len();
        let mut minimum = [f32::INFINITY; 3];
        let mut maximum = [f32::NEG_INFINITY; 3];
        for position in &mesh.positions {
            for component in 0..3 {
                minimum[component] = minimum[component].min(position[component]);
                maximum[component] = maximum[component].max(position[component]);
                binary.extend_from_slice(&position[component].to_le_bytes());
            }
        }
        let position_length = binary.len() - position_offset;
        let position_view = buffer_views.len();
        buffer_views.push(serde_json::json!({
            "buffer": 0,
            "byteLength": position_length,
            "byteOffset": position_offset,
            "target": 34962,
        }));
        let position_accessor = accessors.len();
        accessors.push(serde_json::json!({
            "bufferView": position_view,
            "componentType": 5126,
            "count": mesh.positions.len(),
            "max": maximum,
            "min": minimum,
            "type": "VEC3",
        }));

        let index_offset = binary.len();
        for index in &mesh.indices {
            binary.extend_from_slice(&index.to_le_bytes());
        }
        let index_length = binary.len() - index_offset;
        let index_view = buffer_views.len();
        buffer_views.push(serde_json::json!({
            "buffer": 0,
            "byteLength": index_length,
            "byteOffset": index_offset,
            "target": 34963,
        }));
        let index_accessor = accessors.len();
        let maximum_index = mesh.indices.iter().copied().max().unwrap_or(0);
        let minimum_index = mesh.indices.iter().copied().min().unwrap_or(0);
        accessors.push(serde_json::json!({
            "bufferView": index_view,
            "componentType": 5125,
            "count": mesh.indices.len(),
            "max": [maximum_index],
            "min": [minimum_index],
            "type": "SCALAR",
        }));

        let mesh_index = gltf_meshes.len();
        gltf_meshes.push(serde_json::json!({
            "primitives": [{
                "attributes": { "POSITION": position_accessor },
                "indices": index_accessor,
                "mode": mesh.mode,
            }],
        }));
        nodes.push(serde_json::json!({
            "extras": {
                "ifcExpressId": mesh.express_id,
                "ifcNodeId": mesh.node_id,
            },
            "matrix": mesh.transform,
            "mesh": mesh_index,
        }));
    }

    let scene_nodes = (0..nodes.len()).collect::<Vec<_>>();
    let document = if binary.is_empty() {
        serde_json::json!({
            "asset": { "generator": "1HK oxideav-ifc derivative", "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": scene_nodes }],
        })
    } else {
        serde_json::json!({
            "accessors": accessors,
            "asset": { "generator": "1HK oxideav-ifc derivative", "version": "2.0" },
            "bufferViews": buffer_views,
            "buffers": [{ "byteLength": binary.len() }],
            "meshes": gltf_meshes,
            "nodes": nodes,
            "scene": 0,
            "scenes": [{ "nodes": scene_nodes }],
        })
    };
    let mut json = canonical_json(&document)?;
    while json.len() % 4 != 0 {
        json.push(b' ');
    }
    while binary.len() % 4 != 0 {
        binary.push(0);
    }
    let binary_chunk_bytes = if binary.is_empty() {
        0
    } else {
        8usize
            .checked_add(binary.len())
            .ok_or_else(|| DerivativeError("GLB size overflow".into()))?
    };
    let total_length = 12usize
        .checked_add(8)
        .and_then(|length| length.checked_add(json.len()))
        .and_then(|length| length.checked_add(binary_chunk_bytes))
        .ok_or_else(|| DerivativeError("GLB size overflow".into()))?;
    if total_length > maximum_bytes || total_length > u32::MAX as usize {
        return Err(DerivativeError(format!(
            "geometry limit exceeded: {total_length} > {maximum_bytes}"
        )));
    }

    let mut output = Vec::with_capacity(total_length);
    output.extend_from_slice(b"glTF");
    append_u32(&mut output, 2)?;
    append_u32(&mut output, total_length)?;
    append_u32(&mut output, json.len())?;
    append_u32(&mut output, 0x4e4f534a)?;
    output.extend_from_slice(&json);
    if !binary.is_empty() {
        append_u32(&mut output, binary.len())?;
        append_u32(&mut output, 0x004e4942)?;
        output.extend_from_slice(&binary);
    }
    Ok(output)
}

fn append_u32(output: &mut Vec<u8>, value: usize) -> Result<(), DerivativeError> {
    let value = u32::try_from(value).map_err(|_| DerivativeError("GLB size overflow".into()))?;
    output.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

fn transform_array(transform: Transform, unit_scale: f64) -> Result<[f32; 16], DerivativeError> {
    let [x, y, z] = transform.cols;
    let t = transform.translation;
    Ok([
        finite_f32(x[0])?,
        finite_f32(x[1])?,
        finite_f32(x[2])?,
        0.0,
        finite_f32(y[0])?,
        finite_f32(y[1])?,
        finite_f32(y[2])?,
        0.0,
        finite_f32(z[0])?,
        finite_f32(z[1])?,
        finite_f32(z[2])?,
        0.0,
        scaled_f32(t[0], unit_scale)?,
        scaled_f32(t[1], unit_scale)?,
        scaled_f32(t[2], unit_scale)?,
        1.0,
    ])
}

fn scaled_f32(value: f64, scale: f64) -> Result<f32, DerivativeError> {
    finite_f32(value * scale)
}

fn finite_f32(value: f64) -> Result<f32, DerivativeError> {
    let narrowed = value as f32;
    if value.is_finite() && narrowed.is_finite() {
        Ok(narrowed)
    } else {
        Err(DerivativeError("non-finite geometry value".into()))
    }
}

fn platform_trimmed(value: &str, maximum: usize, label: &str) -> Result<String, DerivativeError> {
    let value = value.trim();
    if value.is_empty() || value.encode_utf16().count() > maximum {
        return Err(DerivativeError(format!("invalid {label}")));
    }
    Ok(value.to_string())
}

fn platform_string(value: &str, maximum: usize, label: &str) -> Result<String, DerivativeError> {
    if value.encode_utf16().count() > maximum {
        return Err(DerivativeError(format!(
            "{label} exceeds the platform limit"
        )));
    }
    Ok(value.to_string())
}

fn validate_global_id(value: &str) -> Result<(), DerivativeError> {
    if value.len() != 22
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$')
    {
        return Err(DerivativeError(format!("invalid IFC GlobalId {value}")));
    }
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), DerivativeError> {
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    if !valid {
        return Err(DerivativeError("source file id must be a UUID".into()));
    }
    Ok(())
}

fn canonical_json(value: &Value) -> Result<Vec<u8>, DerivativeError> {
    canonical_json_with_number_format(value, false)
}

fn platform_canonical_json(value: &Value) -> Result<Vec<u8>, DerivativeError> {
    canonical_json_with_number_format(value, true)
}

fn canonical_json_with_number_format(
    value: &Value,
    use_ecmascript_numbers: bool,
) -> Result<Vec<u8>, DerivativeError> {
    let mut output = String::new();
    write_canonical_json(value, &mut output, use_ecmascript_numbers)?;
    Ok(output.into_bytes())
}

fn write_canonical_json(
    value: &Value,
    output: &mut String,
    use_ecmascript_numbers: bool,
) -> Result<(), DerivativeError> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) if use_ecmascript_numbers => write_ecmascript_number(value, output)?,
        Value::Number(value) => output.push_str(&value.to_string()),
        Value::String(value) => output
            .push_str(&serde_json::to_string(value).map_err(|error| {
                DerivativeError(format!("JSON serialization failure: {error}"))
            })?),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_json(value, output, use_ecmascript_numbers)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            output.push('{');
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key).map_err(|error| {
                    DerivativeError(format!("JSON serialization failure: {error}"))
                })?);
                output.push(':');
                write_canonical_json(value, output, use_ecmascript_numbers)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn write_ecmascript_number(value: &Number, output: &mut String) -> Result<(), DerivativeError> {
    if let Some(value) = value.as_i64() {
        output.push_str(&value.to_string());
        return Ok(());
    }
    if let Some(value) = value.as_u64() {
        output.push_str(&value.to_string());
        return Ok(());
    }
    let value = value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| DerivativeError("non-finite canonical JSON number".into()))?;
    if value == 0.0 {
        output.push('0');
        return Ok(());
    }
    output.push_str(ryu_js::Buffer::new().format(value));
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn write_pair_without_clobber(
    first_target: &Path,
    first_bytes: &[u8],
    second_target: &Path,
    second_bytes: &[u8],
) -> Result<(), DerivativeError> {
    let first_temporary = write_temporary(first_target, first_bytes)?;
    let second_temporary = match write_temporary(second_target, second_bytes) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_file(first_temporary);
            return Err(error);
        }
    };

    if let Err(error) = fs::hard_link(&first_temporary, first_target) {
        let _ = fs::remove_file(first_temporary);
        let _ = fs::remove_file(second_temporary);
        return Err(DerivativeError(format!(
            "cannot publish derivative manifest without clobbering: {error}"
        )));
    }
    if let Err(error) = fs::hard_link(&second_temporary, second_target) {
        let rollback = fs::remove_file(first_target);
        let _ = fs::remove_file(first_temporary);
        let _ = fs::remove_file(second_temporary);
        if let Err(rollback_error) = rollback {
            return Err(DerivativeError(format!(
                "cannot publish derivative geometry ({error}) or roll back manifest ({rollback_error})"
            )));
        }
        return Err(DerivativeError(format!(
            "cannot publish derivative geometry without clobbering: {error}"
        )));
    }
    let _ = fs::remove_file(first_temporary);
    let _ = fs::remove_file(second_temporary);
    Ok(())
}

fn write_temporary(target: &Path, bytes: &[u8]) -> Result<PathBuf, DerivativeError> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("derivative");
    for sequence in 0..1_000 {
        let path = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), sequence));
        let file = OpenOptions::new().write(true).create_new(true).open(&path);
        let mut file = match file {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(DerivativeError(format!(
                    "cannot create derivative temporary file: {error}"
                )))
            }
        };
        if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(DerivativeError(format!(
                "cannot write derivative temporary file: {error}"
            )));
        }
        return Ok(path);
    }
    Err(DerivativeError(
        "cannot allocate derivative temporary file".into(),
    ))
}
