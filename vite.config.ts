import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { checkCriteriaDir, checkDataDir, checkDefaultStatus } from './scripts/check-data.ts';
import { createAjv, DEFAULT_DOMAIN_DIR, EXTRA_DOMAIN_DIRS, loadDomain, ROOT } from './scripts/load-domain.ts';
import { loadFinance, loadPathways } from './scripts/pathways/load.ts';
import { buildEntitySchema, buildStatusSchema } from './src/lib/schema-gen.ts';

/**
 * Build-time data for one domain (DOMAIN_DIR, default domains/schools), no runtime fetches:
 * - `virtual:domain`: the domain config, catalog, scope values, areas, overlays and the
 *   domain's dictionaries, checked. A broken domain fails the build.
 * - `virtual:entities`: every entity file, validated. Invalid data fails the build.
 * - `virtual:criteria`: every criteria set, checked against the domain.
 * - `virtual:entity-validator`, `virtual:status-validator`: Ajv validators precompiled from the
 *   generated schemas (CSP-safe).
 */
function domainData(dir: string): Plugin {
  const ids = { domain: '\0virtual:domain', entities: '\0virtual:entities', validator: '\0virtual:entity-validator', criteria: '\0virtual:criteria', status: '\0virtual:status-validator' };
  const names: Record<string, string> = { 'virtual:domain': ids.domain, 'virtual:entities': ids.entities, 'virtual:entity-validator': ids.validator, 'virtual:criteria': ids.criteria, 'virtual:status-validator': ids.status };
  return {
    name: 'domain-data',
    resolveId(id) {
      return names[id];
    },
    // Dev server: reload when the domain or its data change.
    configureServer(server) {
      const { domain } = loadDomain(dir);
      const watched = [dir, domain.config.paths.catalog, domain.config.paths.entities, domain.config.paths.criteria, domain.config.paths.overlays ?? dir].map((p) => resolve(ROOT, p));
      server.watcher.add(watched);
      const onChange = (file: string) => {
        if (!watched.some((w) => file.startsWith(w.replace(/[^/]*\.yaml$/, '')))) return;
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
      if (!Object.values(ids).includes(id)) return;
      let loaded;
      try {
        loaded = loadDomain(dir);
      } catch (e) {
        this.error(`Invalid domain:\n${(e as Error).message}`);
      }
      const { domain, files, overlays, i18n } = loaded;
      if (id === ids.domain) {
        const entities = checkDataDir(domain.config.paths.entities, domain).entities.map((e) => e.id);
        const sets = checkCriteriaDir(domain.config.paths.criteria, domain).sets.map((c) => c.id);
        const status = checkDefaultStatus(domain, entities, sets);
        if (status.errors.length > 0) this.error(`Invalid default status:\n${status.errors.join('\n')}`);
        return `export default ${JSON.stringify({ files, overlays, i18n, statusDefault: status.file ?? null })};`;
      }
      if (id === ids.entities) {
        const { entities, errors } = checkDataDir(domain.config.paths.entities, domain);
        if (errors.length > 0) this.error(`Invalid data:\n${errors.join('\n')}`);
        entities.sort((a, b) => a.name.localeCompare(b.name, domain.config.display.sort_locale));
        return `export default ${JSON.stringify(entities)};`;
      }
      if (id === ids.criteria) {
        const { sets, errors } = checkCriteriaDir(domain.config.paths.criteria, domain);
        if (errors.length > 0) this.error(`Invalid criteria:\n${errors.join('\n')}`);
        return `export default ${JSON.stringify(sets)};`;
      }
      const ajv = createAjv({ standalone: true });
      const validate = ajv.compile(id === ids.status ? buildStatusSchema(domain) : buildEntitySchema(domain));
      const code = standaloneCode(ajv, validate);
      // Ajv emits require() for some keywords even in ESM mode; that breaks in the browser.
      if (code.includes('require(')) this.error('Precompiled validator needs require(); avoid that schema keyword');
      return code;
    },
  };
}

/**
 * - `virtual:extra-domains`: the browse-only domains (EXTRA_DOMAIN_DIRS, e.g. universities):
 *   domain files, dictionaries and validated entities. List and detail pages only.
 * - `virtual:plan`: pathways (data/pathways) and finance inputs (data/finance), checked.
 */
function extraData(dirs: string[]): Plugin {
  const ids: Record<string, string> = { 'virtual:extra-domains': '\0virtual:extra-domains', 'virtual:plan': '\0virtual:plan' };
  return {
    name: 'extra-data',
    resolveId: (id) => ids[id],
    configureServer(server) {
      server.watcher.add(['data/pathways', 'data/finance', 'data/universities', 'domains/universities'].map((p) => resolve(ROOT, p)));
    },
    load(id) {
      if (id === ids['virtual:plan']) {
        try {
          return `export default ${JSON.stringify({ pathways: loadPathways(), finance: loadFinance() })};`;
        } catch (e) {
          this.error(`Invalid pathways or finance data:\n${(e as Error).message}`);
        }
      }
      if (id !== ids['virtual:extra-domains']) return;
      const out = dirs.map((dir) => {
        let loaded;
        try {
          loaded = loadDomain(dir);
        } catch (e) {
          this.error(`Invalid domain ${dir}:\n${(e as Error).message}`);
        }
        const { domain, files, overlays, i18n } = loaded;
        const { entities, errors } = checkDataDir(domain.config.paths.entities, domain);
        if (errors.length > 0) this.error(`Invalid data:\n${errors.join('\n')}`);
        entities.sort((a, b) => a.name.localeCompare(b.name, domain.config.display.sort_locale));
        return { files, overlays, i18n, entities };
      });
      return `export default ${JSON.stringify(out)};`;
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
    "connect-src 'self' https://api.github.com", // personal status (read-only, token sent only there)
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
  plugins: [domainData(DEFAULT_DOMAIN_DIR), extraData(EXTRA_DOMAIN_DIRS), contentSecurityPolicy()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
