// Build-time data from the domain directory (see vite.config.ts).
declare module 'virtual:domain' {
  import type { DomainFiles, RetrievalOverlay } from './lib/domain.ts';
  const data: { files: DomainFiles; overlays: RetrievalOverlay[]; i18n: Record<string, Record<string, string>> };
  export default data;
}

declare module 'virtual:entities' {
  import type { Entity } from './lib/entity.ts';
  const entities: Entity[];
  export default entities;
}

declare module 'virtual:entity-validator' {
  import type { ValidateFunction } from 'ajv';
  const validate: ValidateFunction;
  export default validate;
}

declare module 'virtual:criteria' {
  const sets: import('./lib/criteria.ts').CriteriaSet[];
  export default sets;
}
