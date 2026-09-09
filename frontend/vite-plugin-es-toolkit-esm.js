import fs from 'node:fs';
import path from 'node:path';

/**
 * Forces `es-toolkit/compat/*` onto its ESM build.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Recharts imports es-toolkit through deep paths — `import get from
 * 'es-toolkit/compat/get'`. es-toolkit's export map has no `import` condition
 * for those:
 *
 *     "./compat/*": { "default": { "default": "./compat/*.js" } }
 *
 * so they always resolve to CJS, even though a matching `.mjs` sits in
 * `dist/compat/**` right beside it. Each of those files is a one-line shim:
 *
 *     module.exports = require('../dist/compat/object/get.js').get;
 *
 * Rolldown then converts that chain to ESM and emits a local binding with the
 * same name as the factory function it calls:
 *
 *     var require_isArrayLike = require_isArrayLike();
 *
 * `var` hoisting makes the local `undefined` at the point of the call, so it
 * throws `TypeError: t is not a function` and the whole Analytics page renders
 * blank. It only shows in a production build; dev never runs that transform.
 *
 * WHY A PLUGIN AND NOT AN ALIAS
 * -----------------------------
 * A plain alias to the `.mjs` would break the call sites: recharts imports a
 * DEFAULT export, while the ESM file exports a NAMED one (`export { get }`).
 * So this emits a tiny re-export module that bridges the two.
 *
 * Remove this once rolldown fixes the interop or es-toolkit adds an `import`
 * condition to its deep exports — it is a workaround, not a design.
 */
export default function esToolkitEsm() {
  const PREFIX = '\0es-toolkit-esm:';
  const req = /^es-toolkit\/compat\/([A-Za-z0-9_$]+)$/;
  let distDir = null;
  const cache = new Map();

  /** Locates `<name>.mjs` anywhere under dist/compat. */
  function findMjs(name) {
    if (cache.has(name)) return cache.get(name);
    const stack = [distDir];
    let found = null;
    while (stack.length && !found) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name === `${name}.mjs`) { found = full; break; }
      }
    }
    cache.set(name, found);
    return found;
  }

  return {
    name: 'es-toolkit-esm',
    enforce: 'pre',

    configResolved(config) {
      distDir = path.join(config.root, 'node_modules', 'es-toolkit', 'dist', 'compat');
      if (!fs.existsSync(distDir)) distDir = null;
    },

    resolveId(source) {
      if (!distDir) return null;
      const m = req.exec(source);
      if (!m) return null;
      return findMjs(m[1]) ? PREFIX + m[1] : null;
    },

    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const name = id.slice(PREFIX.length);
      const file = findMjs(name);
      if (!file) return null;
      const spec = JSON.stringify(file.split(path.sep).join('/'));
      // Both forms: recharts uses the default import, but re-exporting the
      // name as well keeps any named importer working.
      return `export { ${name} as default, ${name} } from ${spec};`;
    },
  };
}
