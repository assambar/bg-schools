import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { checkDataDir } from './scripts/check-data.ts';
import { CATALOG_DIR, createAjv, loadCatalog } from './scripts/schema.ts';
import { buildSchoolSchema } from './src/lib/schema-gen.ts';

const DATA_DIR = resolve(import.meta.dirname, 'data');
const SCHOOLS_DIR = resolve(DATA_DIR, 'schools');

/**
 * Build-time data, no runtime fetches:
 * - `virtual:catalog`: data/catalog/*.yaml, checked. A broken catalog fails the build.
 * - `virtual:schools`: every data/schools/*.yaml, validated. Invalid data fails the build.
 * - `virtual:school-validator`: Ajv validator precompiled from the generated schema (CSP-safe).
 */
function schoolsData(): Plugin {
  const ids = { schools: '\0virtual:schools', catalog: '\0virtual:catalog', validator: '\0virtual:school-validator' };
  const names: Record<string, string> = { 'virtual:schools': ids.schools, 'virtual:catalog': ids.catalog, 'virtual:school-validator': ids.validator };
  return {
    name: 'schools-data',
    resolveId(id) {
      return names[id];
    },
    // Dev server: reload when data or catalog files change.
    configureServer(server) {
      server.watcher.add([DATA_DIR, fileURLToPath(CATALOG_DIR)]);
      const onChange = (file: string) => {
        if (!file.startsWith(DATA_DIR)) return;
        const graph = server.environments.client.moduleGraph;
        for (const id of Object.values(ids)) {
          const mod = graph.getModuleById(id);
          if (mod) graph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
    },
    load(id) {
      if (id === ids.catalog) {
        const { raw, catalog } = loadCatalog();
        return `export default ${JSON.stringify({ raw, grades: catalog.grades, neighborhoods: catalog.neighborhoods })};`;
      }
      if (id === ids.schools) {
        const { schools, errors } = checkDataDir(SCHOOLS_DIR);
        if (errors.length > 0) this.error(`Invalid data:\n${errors.join('\n')}`);
        schools.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
        return `export default ${JSON.stringify(schools)};`;
      }
      if (id === ids.validator) {
        const ajv = createAjv({ standalone: true });
        const validate = ajv.compile(buildSchoolSchema(loadCatalog().catalog));
        const code = standaloneCode(ajv, validate);
        // Ajv emits require() for some keywords even in ESM mode; that breaks in the browser.
        if (code.includes('require(')) this.error('Precompiled validator needs require(); avoid that schema keyword');
        return code;
      }
    },
  };
}

/** Strict CSP for the production build only (Vite's dev server injects inline styles). */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    // Right after <meta charset>, before any script or stylesheet.
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `$&\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig({
  base: '/bg-schools/', // project Pages site: https://assambar.github.io/bg-schools/
  plugins: [schoolsData(), contentSecurityPolicy()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
