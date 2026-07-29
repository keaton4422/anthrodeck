import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

// Some packages cannot be bundled and must ship as real files.
//
// fastify's validation stack (ajv, fast-json-stringify) builds require() paths at runtime from
// generated validator code — `require("ajv/dist/runtime/equal")` and friends. Rollup cannot see
// through that, so bundling fastify produces a package whose requires resolve to nothing. Note that
// this fails only when a route actually compiles a schema, which is exactly the kind of bug that
// hides until a user clicks "Share preview" in the field.
//
// Everything else in the dependency list bundles cleanly and is NOT listed here — a bundled module
// is smaller and faster to load than a copied tree, so this stays a deliberate exception list.
export const SHIP_ROOTS = ['fastify', '@fastify/static', '@fastify/http-proxy'];

// Exported for testing. Walks the dependency graph from `roots`, honouring npm's nested-then-hoisted
// resolution order, and returns every package directory that has to travel with the app.
export function collectClosure(roots, nodeModulesDir, readPkg) {
  const read = readPkg ?? ((dir) => {
    const p = path.join(dir, 'package.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null;
  });

  const resolved = new Map();   // name -> absolute dir
  const queue = [...roots];
  const seen = new Set();

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    const dir = path.join(nodeModulesDir, name);
    const pkg = read(dir);
    if (!pkg) continue;         // optional dep that was never installed — skip rather than throw
    resolved.set(name, dir);

    // Runtime deps only. devDependencies never ship; optionalDependencies are allowed to be absent
    // by definition, so a missing one must not fail the build.
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      if (!seen.has(dep) && existsSync(path.join(nodeModulesDir, dep))) queue.push(dep);
    }
  }
  return resolved;
}

export function shipInto(buildPath, projectDir = process.cwd()) {
  const nm = path.join(projectDir, 'node_modules');
  const closure = collectClosure(SHIP_ROOTS, nm);
  const dest = path.join(buildPath, 'node_modules');
  mkdirSync(dest, { recursive: true });

  for (const [name, dir] of closure) {
    const target = path.join(dest, name);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(dir, target, {
      recursive: true,
      dereference: true,
      // Trim weight that never gets required at runtime.
      filter: (src) => !/[\\/](test|tests|__tests__|\.github|docs?|example|examples)[\\/]/i.test(src),
    });
  }
  return [...closure.keys()].sort();
}
