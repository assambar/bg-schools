declare module 'virtual:schools' {
  import type { School } from './lib/school.ts';
  const schools: School[];
  export default schools;
}

declare module 'virtual:catalog' {
  import type { Grade, Neighborhood, RawCatalog } from './lib/catalog.ts';
  const data: { raw: RawCatalog; grades: Grade[]; neighborhoods: Neighborhood[] };
  export default data;
}

declare module 'virtual:school-validator' {
  import type { ValidateFunction } from 'ajv';
  const validate: ValidateFunction;
  export default validate;
}
