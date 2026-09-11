#!/usr/bin/env node
import { readFileSync } from "node:fs";

const APPROVED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

const path = process.argv[2];
if (!path) {
  console.error("usage: check-licenses.mjs cargo-metadata.json");
  process.exit(2);
}

const metadata = JSON.parse(readFileSync(path, "utf8"));
const failures = [];
const packages = resolvedPackages(metadata);

for (const pkg of packages) {
  if (!pkg.license) {
    failures.push(`${pkg.name}@${pkg.version}: missing license metadata`);
    continue;
  }
  const result = evaluate(pkg.license.replaceAll("/", " OR "));
  if (!result.ok) {
    failures.push(`${pkg.name}@${pkg.version}: ${pkg.license} (disallowed: ${[...result.bad].join(", ")})`);
  }
}

if (failures.length) {
  console.error(`license closure rejected:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`license closure accepted: ${packages.length} packages`);

function resolvedPackages(metadata) {
  if (!metadata.resolve?.root) return metadata.packages ?? [];
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const reachable = new Set();
  const pending = [metadata.resolve.root];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const dependency of nodes.get(id)?.deps ?? []) {
      const enabled = !dependency.dep_kinds?.length
        || dependency.dep_kinds.some((kind) => kind.target !== "cfg(any())");
      if (enabled) pending.push(dependency.pkg);
    }
  }
  return (metadata.packages ?? []).filter((pkg) => reachable.has(pkg.id));
}

function evaluate(expression) {
  const tokens = expression.match(/\(|\)|\bAND\b|\bOR\b|\bWITH\b|[^\s()]+/g) ?? [];
  let index = 0;

  function primary() {
    if (tokens[index] === "(") {
      index += 1;
      const value = orExpression();
      if (tokens[index] !== ")") return { ok: false, bad: new Set(["malformed-expression"]) };
      index += 1;
      return value;
    }
    const identifier = tokens[index++];
    return { ok: APPROVED.has(identifier), bad: new Set(APPROVED.has(identifier) ? [] : [identifier]) };
  }

  function andExpression() {
    let left = primary();
    while (tokens[index] === "AND" || tokens[index] === "WITH") {
      index += 1;
      const right = primary();
      left = { ok: left.ok && right.ok, bad: new Set([...left.bad, ...right.bad]) };
    }
    return left;
  }

  function orExpression() {
    let left = andExpression();
    while (tokens[index] === "OR") {
      index += 1;
      const right = andExpression();
      left = left.ok || right.ok
        ? { ok: true, bad: new Set() }
        : { ok: false, bad: new Set([...left.bad, ...right.bad]) };
    }
    return left;
  }

  const result = orExpression();
  return index === tokens.length ? result : { ok: false, bad: new Set(["malformed-expression"]) };
}
