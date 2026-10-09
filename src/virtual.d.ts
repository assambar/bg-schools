// Build-time data from the domain directory (see vite.config.ts).
declare module 'virtual:domain' {
  import type { DomainFiles, RetrievalOverlay } from './lib/domain.ts';
  const data: { files: DomainFiles; overlays: RetrievalOverlay[]; i18n: Record<string, Record<string, string>>; statusDefault: import('./lib/status.ts').StatusFile | null };
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

declare module 'virtual:status-validator' {
  import type { ValidateFunction } from 'ajv';
  const validate: ValidateFunction;
  export default validate;
}

declare module 'virtual:extra-domains' {
  import type { DomainFiles, RetrievalOverlay } from './lib/domain.ts';
  import type { Entity } from './lib/entity.ts';
  const domains: { files: DomainFiles; overlays: RetrievalOverlay[]; i18n: Record<string, Record<string, string>>; entities: Entity[] }[];
  export default domains;
}

declare module 'virtual:plan' {
  const plan: { pathways: import('./pathways/pathways.ts').Pathways; finance: import('./pathways/finance.ts').FinanceData };
  export default plan;
}
