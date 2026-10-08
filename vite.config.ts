import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { checkDataDir } from './scripts/check-data.ts';
import { createAjv, loadSchema, SCHEMA_PATH } from './scripts/schema.ts';

const DATA_DIR = resolve(import.meta.dirname, 'data/schools');

/**
 * Build-time data, no runtime fetches:
 * - `virtual:schools`: every data/schools/*.yaml, validated. Invalid data fails the build.
 * - `virtual:school-validator`: Ajv validator precompiled from the schema (CSP-safe).
 */
function schoolsData(): Plugin {
  const ids = { schools: '\0virtual:schools', validator: '\0virtual:school-validator' };
  return {
    name: 'schools-data',
    resolveId(id) {
      if (id === 'virtual:schools') return ids.schools;
      if (id === 'virtual:school-validator') return ids.validator;
    },
    // Dev server: reload when data or schema files change.
    configureServer(server) {
      const schemaFile = fileURLToPath(SCHEMA_PATH);
      server.watcher.add([DATA_DIR, schemaFile]);
      const onChange = (file: string) => {
        if (!file.startsWith(DATA_DIR) && file !== schemaFile) return;
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
      if (id === ids.schools) {
        const { schools, errors } = checkDataDir(DATA_DIR);
        if (errors.length > 0) this.error(`Invalid data:\n${errors.join('\n')}`);
        schools.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return `export default ${JSON.stringify(schools)};`;
      }
      if (id === ids.validator) {
        const ajv = createAjv({ standalone: true });
        const validate = ajv.compile(loadSchema());
        const code = standaloneCode(ajv, validate);
        // Ajv emits require() for some keywords/formats even in ESM mode; that
        // breaks in the browser. Fail loudly if a schema change introduces one.
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
