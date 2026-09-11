use oxideav_ifc::{mesh_from_product_shape, parse_step_with_limits, Model, StepLimits};
use serde_json::json;
use std::{collections::BTreeMap, env, fs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args_os().nth(1).ok_or("usage: diagnose SOURCE.ifc")?;
    let input = fs::read(path)?;
    let step = parse_step_with_limits(
        &input,
        &StepLimits {
            max_input_len: 256 * 1024 * 1024,
            max_instances: 8_000_000,
            max_depth: 64,
            max_string_len: 16 * 1024 * 1024,
        },
    )?;
    let model = Model::from_step(&step);
    let mut products = model.products().collect::<Vec<_>>();
    products.sort_by_key(|product| product.id());

    let mut represented_products = 0_u64;
    let mut meshed_products = 0_u64;
    let mut vertices = 0_u64;
    let mut triangles = 0_u64;
    let mut failures: BTreeMap<(String, String), (u64, Vec<u64>)> = BTreeMap::new();
    for product in products {
        let Some(representation_id) = product.representation() else {
            continue;
        };
        represented_products += 1;
        match mesh_from_product_shape(&step, representation_id) {
            Ok(mesh) if !mesh.positions.is_empty() && !mesh.triangles.is_empty() => {
                meshed_products += 1;
                vertices += mesh.positions.len() as u64;
                triangles += mesh.triangles.len() as u64;
            }
            Ok(_) => {
                record_failure(
                    &mut failures,
                    product.keyword(),
                    "empty geometry".to_string(),
                    product.id(),
                );
            }
            Err(error) => {
                record_failure(
                    &mut failures,
                    product.keyword(),
                    error.to_string(),
                    product.id(),
                );
            }
        }
    }

    let failures = failures
        .into_iter()
        .map(|((product_type, error), (count, sample_express_ids))| {
            json!({
                "productType": product_type,
                "error": error,
                "count": count,
                "sampleExpressIds": sample_express_ids,
            })
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        json!({
            "representedProducts": represented_products,
            "meshedProducts": meshed_products,
            "vertices": vertices,
            "triangles": triangles,
            "failures": failures,
        })
    );
    Ok(())
}

fn record_failure(
    failures: &mut BTreeMap<(String, String), (u64, Vec<u64>)>,
    product_type: &str,
    error: String,
    express_id: u64,
) {
    let entry = failures
        .entry((product_type.to_string(), error))
        .or_insert_with(|| (0, Vec::new()));
    entry.0 += 1;
    if entry.1.len() < 5 {
        entry.1.push(express_id);
    }
}
