// Generates the JSON Schemas for entity files and criteria sets from a domain (config +
// catalog), so a new dimension only needs a catalog entry. Used by CI, the build and
// (precompiled) the browser. Generic: nothing here knows about a particular domain.
import { CADENCES, CHECK_FLAGS, PERIODS, SOURCE_KINDS, type Domain, type Dimension, type RecordField } from './domain.ts';

type Schema = Record<string, unknown>;

const DATE = '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$';
const URL = '^https?://[^\\s/?#]+\\.[^\\s/?#]+([/?#]\\S*)?$';
const TIME_RANGE = '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$';
export const YEAR = '^[0-9]{4}/[0-9]{4}$';
export const SOURCE_REF = '^src-[a-z0-9]+(-[a-z0-9]+)*$';
export const ID = '^[a-z0-9]+(-[a-z0-9]+)*$';

const text: Schema = { type: 'string', pattern: '\\S' };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});

const moneySchema = (dom: Domain): Schema => ({
  ...obj({
    amount: { type: 'number', minimum: 0 },
    min: { type: 'number', minimum: 0 },
    max: { type: 'number', minimum: 0 },
    currency: { enum: [...(dom.config.money?.currencies ?? [])] },
    per: { enum: [...PERIODS] },
    months: { type: 'integer', minimum: 1, maximum: 12 },
  }, ['currency', 'per']),
  anyOf: [{ required: ['amount'] }, { required: ['min', 'max'] }],
});

function fieldSchema(f: RecordField, dom: Domain): Schema {
  switch (f.type) {
    case 'bool': return { type: 'boolean' };
    case 'int': return { type: 'integer', minimum: f.min ?? 0 };
    case 'number': return { type: 'number', minimum: f.min ?? 0 };
    case 'text': return text;
    case 'time_range': return { type: 'string', pattern: TIME_RANGE };
    case 'enum': return { enum: [...dom.valueSets[f.values!]] };
    case 'money': return moneySchema(dom);
  }
}

function valueSchema(d: Dimension, dom: Domain): Schema {
  switch (d.type) {
    case 'bool': return { type: 'boolean' };
    case 'int': return { type: 'integer', minimum: 0 };
    case 'number': return { type: 'number', minimum: 0 };
    case 'text': return text;
    case 'text_list': return { type: 'array', minItems: 1, items: text };
    case 'url': return { type: 'string', pattern: URL };
    case 'date': return { type: 'string', pattern: DATE };
    case 'date_list': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: DATE } };
    case 'enum': return { enum: [...dom.valueSets[d.values!]] };
    case 'multi_enum': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: [...dom.valueSets[d.values!]] } };
    case 'range': return obj({ min: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } }, ['min', 'max']);
    case 'time_range': return { type: 'string', pattern: TIME_RANGE };
    case 'money': return moneySchema(dom);
    default: {
      const rec = dom.records[d.type];
      const fields = Object.entries(rec.fields);
      return obj(Object.fromEntries(fields.map(([k, f]) => [k, fieldSchema(f, dom)])), fields.filter(([, f]) => f.required).map(([k]) => k));
    }
  }
}

export const srcSchema: Schema = obj({
  kind: { enum: [...SOURCE_KINDS] },
  date: { type: 'string', pattern: DATE },
  url: { type: 'string', pattern: URL },
  ref: { type: 'string', pattern: ID },
  source_ref: { type: 'string', pattern: SOURCE_REF },
  by: text,
  verified: { type: 'boolean' },
  check: { enum: [...CHECK_FLAGS] },
  note: text,
});

export const retrievalSchema: Schema = obj({
  methods: { type: 'array', items: text },
  cadence: { enum: [...CADENCES] },
  automatable: { type: 'boolean' },
  steps: { type: 'array', items: text },
  note: text,
  replace: { type: 'boolean' },
});

function scopeSchema(dom: Domain): Schema {
  const props: Record<string, Schema> = {};
  for (const a of dom.config.scopes) {
    const one: Schema = a.pattern ? { type: 'string', pattern: a.pattern }
      : a.ref ? { type: 'string', pattern: ID }
      : { type: 'string', enum: (dom.scopeValues[a.id] ?? []).map((v) => v.id) };
    props[a.id] = a.list ? { anyOf: [one, { type: 'array', minItems: 1, uniqueItems: true, items: one }] } : one;
  }
  return obj(props);
}

export function buildEntitySchema(dom: Domain): Schema {
  const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
  const defs: Record<string, Schema> = { src: srcSchema, retrieval: retrievalSchema, scope: scopeSchema(dom) };
  // One shared definition per value type (per value set for enums) keeps the
  // generated schema and the precompiled browser validator small.
  const values: Record<string, Schema> = {};
  for (const d of dom.dimensions) {
    const key = d.values ? `${d.type}__${d.values}` : d.type;
    if (!defs[`entry_${key}`]) {
      const entry = obj({ v: valueSchema(d, dom), src: ref('src'), scope: ref('scope'), note: text }, ['v']);
      defs[`entry_${key}`] = entry;
      defs[`dim_${key}`] = { anyOf: [ref(`entry_${key}`), { type: 'array', minItems: 1, items: ref(`entry_${key}`) }] };
    }
    values[d.id] = ref(`dim_${key}`);
  }
  const props: Record<string, Schema> = {
    id: { type: 'string', pattern: dom.config.entity.id_pattern },
    name: text,
    name_en: text,
  };
  const required = ['id', 'name', 'values'];
  if (dom.config.locations) {
    const area = { type: 'string', enum: dom.areas.map((n) => n.id) };
    props.sites = {
      type: 'array',
      minItems: 1,
      items: obj({
        id: { type: 'string', pattern: ID },
        address: text,
        neighborhood: { anyOf: [area, { type: 'array', minItems: 1, uniqueItems: true, items: area }] },
        geo: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
        src: ref('src'),
      }, ['id']),
    };
    required.splice(2, 0, 'sites');
  }
  Object.assign(props, {
    defaults: obj({ src: ref('src') }),
    values: obj(values),
    retrieval: { type: 'object', propertyNames: { enum: Object.keys(values) }, additionalProperties: ref('retrieval') },
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: dom.config.id,
    description: `One entity of the "${dom.config.id}" domain, stored as ${dom.config.paths.entities}/<id>.yaml. Generated from the domain config and ${dom.config.paths.catalog}.`,
    ...obj(props, required),
    $defs: defs,
  };
}

/** JSON Schema for criteria set files. Meaning (dimension ids, value types) is checked by checkCriteria. */
export function buildCriteriaSchema(dom: Domain): Schema {
  const anyValue: Schema = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };
  const bound: Schema = dom.config.money ? { anyOf: [{ type: 'number' }, moneySchema(dom)] } : { type: 'number' };
  const dimRule = obj({
    dim: { type: 'string', pattern: '^[a-z0-9_]+(\\.[a-z0-9_]+)?$' },
    is: anyValue,
    in: { type: 'array', minItems: 1, items: anyValue },
    has: { anyOf: [{ type: 'string' }, { type: 'array', minItems: 1, items: { type: 'string' } }] },
    gte: bound,
    lte: bound,
    exists: { type: 'boolean' },
    where: { type: 'object', minProperties: 1, additionalProperties: anyValue },
    covers: { enum: ['context'] },
    weight: { type: 'number', exclusiveMinimum: 0 },
  }, ['dim']);
  dimRule.minProperties = 2;
  const areaRule = obj({
    neighborhood: obj({ in: { type: 'array', items: { type: 'string', pattern: ID } }, editable: { type: 'boolean' } }, ['in']),
    weight: { type: 'number', exclusiveMinimum: 0 },
  }, ['neighborhood']);
  const distanceRule = obj({ within_km: obj({ km: { type: 'number', exclusiveMinimum: 0 } }, ['km']), weight: { type: 'number', exclusiveMinimum: 0 } }, ['within_km']);
  const rules: Schema = { type: 'array', items: { oneOf: dom.config.locations ? [dimRule, areaRule, distanceRule] : [dimRule] } };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Criteria set',
    ...obj({ id: { type: 'string', pattern: ID }, kind: { enum: [...dom.config.criteria.kinds] }, require: rules, prefer: rules }, ['id', 'kind']),
  };
}

/** JSON Schema for personal status files (domain config `status`). Ids are checked by checkStatus. */
export function buildStatusSchema(dom: Domain): Schema {
  const values = dom.config.status?.values ?? [];
  const props: Record<string, Schema> = {
    kind: { const: 'status' },
    domain: { type: 'string', pattern: ID },
    entities: {
      type: 'object',
      propertyNames: { pattern: dom.config.entity.id_pattern },
      additionalProperties: obj({
        status: { enum: [...values] },
        notes: text,
        gut_feeling: { type: 'integer', minimum: 1, maximum: 5 },
        updated: { type: 'string', pattern: DATE },
      }, ['status']),
    },
    criteria: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: ID } },
  };
  if (dom.config.locations) {
    props.near = { type: 'array', uniqueItems: true, items: { type: 'string', pattern: ID } };
    props.place = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } };
  }
  if (dom.config.money) props.budget = moneySchema(dom);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Personal status (${dom.config.id})`,
    ...obj(props, ['kind', 'domain', 'entities']),
  };
}
