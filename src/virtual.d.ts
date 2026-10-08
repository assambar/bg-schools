declare module 'virtual:schools' {
  import type { School } from './lib/school.ts';
  const schools: School[];
  export default schools;
}

declare module 'virtual:school-validator' {
  import type { ValidateFunction } from 'ajv';
  const validate: ValidateFunction;
  export default validate;
}
