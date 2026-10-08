// Generates the JSON Schema for school files from the catalog, so a new dimension
// only needs a catalog entry. Used by CI, the build and (precompiled) the browser.
import { BUILTIN_SETS, CHECK_FLAGS, SOURCE_KINDS, type Catalog, type Dimension } from './catalog.ts';

type Schema = Record<string, unknown>;

const DATE = '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$';
const URL = '^https?://[^\\s/?#]+\\.[^\\s/?#]+([/?#]\\S*)?$';
const TIME_RANGE = '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$';
export const YEAR = '^[0-9]{4}/[0-9]{4}$';
export const SOURCE_REF = '^src-[a-z0-9]+(-[a-z0-9]+)*$';
const ID = '^[a-z0-9]+(-[a-z0-9]+)*$';

const text: Schema = { type: 'string', pattern: '\\S' };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});

const money: Schema = {
  ...obj({
    amount: { type: 'number', minimum: 0 },
    min: { type: 'number', minimum: 0 },
    max: { type: 'number', minimum: 0 },
    currency: { enum: [...BUILTIN_SETS.currency] },
    per: { enum: [...BUILTIN_SETS.per] },
    months: { type: 'integer', minimum: 1, maximum: 12 },
  }, ['currency', 'per']),
  anyOf: [{ required: ['amount'] }, { required: ['min', 'max'] }],
};

function valueSchema(d: Dimension, cat: Catalog): Schema {
  switch (d.type) {
    case 'bool': return { type: 'boolean' };
    case 'int': return { type: 'integer', minimum: 0 };
    case 'number': return { type: 'number', minimum: 0 };
    case 'text': return text;
    case 'text_list': return { type: 'array', minItems: 1, items: text };
    case 'url': return { type: 'string', pattern: URL };
    case 'date': return { type: 'string', pattern: DATE };
    case 'date_list': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: DATE } };
    case 'enum': return { enum: [...cat.valueSets[d.values!]] };
    case 'multi_enum': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: [...cat.valueSets[d.values!]] } };
    case 'range': return obj({ min: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } }, ['min', 'max']);
    case 'time_range': return { type: 'string', pattern: TIME_RANGE };
    case 'money': return money;
    case 'fee_item': return obj({ included: { type: 'boolean' }, price: money }, ['included']);
    case 'rating': return obj({
      score: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 1 },
      count: { type: 'integer', minimum: 0 }, site: text,
    }, ['score', 'max']);
    case 'offering': return obj({
      offered: { type: 'boolean' }, location: { enum: [...BUILTIN_SETS.location] }, included: { type: 'boolean' },
      frequency: text, partner: text, from_age: { type: 'integer', minimum: 0 },
    }, ['offered']);
    case 'service': return obj({
      available: { type: 'boolean' }, included: { type: 'boolean' }, hours: { type: 'string', pattern: TIME_RANGE },
      frequency: text, price: money,
    }, ['available']);
    case 'link': return obj({
      exists: { type: 'boolean' }, name: text, grades: text, same_campus: { type: 'boolean' },
      curriculum: text, tuition: money,
    }, ['exists']);
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
  cadence: { enum: ['once', 'yearly', 'each_term', 'monthly'] },
  automatable: { type: 'boolean' },
  steps: { type: 'array', items: text },
  note: text,
  replace: { type: 'boolean' },
});

export function buildSchoolSchema(cat: Catalog): Schema {
  const grades = cat.grades.map((g) => g.id);
  const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
  const defs: Record<string, Schema> = {
    src: srcSchema,
    retrieval: retrievalSchema,
    scope: obj({
      year: { type: 'string', pattern: YEAR },
      grade: { anyOf: [{ enum: grades }, { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: grades } }] },
      site: { type: 'string', pattern: ID },
    }),
  };
  // One shared definition per value type (per value set for enums) keeps the
  // generated schema and the precompiled browser validator small.
  const values: Record<string, Schema> = {};
  for (const d of cat.dimensions) {
    const key = d.values ? `${d.type}__${d.values}` : d.type;
    if (!defs[`entry_${key}`]) {
      const entry = obj({ v: valueSchema(d, cat), src: ref('src'), scope: ref('scope'), note: text }, ['v']);
      defs[`entry_${key}`] = entry;
      defs[`dim_${key}`] = { anyOf: [ref(`entry_${key}`), { type: 'array', minItems: 1, items: ref(`entry_${key}`) }] };
    }
    values[d.id] = ref(`dim_${key}`);
  }
  const nbhd = { type: 'string', enum: cat.neighborhoods.map((n) => n.id) };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'School',
    description: 'One school or kindergarten. Stored as data/schools/<id>.yaml. Generated from data/catalog/dimensions.yaml.',
    ...obj({
      id: { type: 'string', pattern: ID },
      name: text,
      name_en: text,
      sites: {
        type: 'array',
        minItems: 1,
        items: obj({
          id: { type: 'string', pattern: ID },
          address: text,
          neighborhood: { anyOf: [nbhd, { type: 'array', minItems: 1, uniqueItems: true, items: nbhd }] },
          geo: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
          src: ref('src'),
        }, ['id']),
      },
      defaults: obj({ src: ref('src') }),
      values: obj(values),
      retrieval: { type: 'object', propertyNames: { enum: Object.keys(values) }, additionalProperties: ref('retrieval') },
    }, ['id', 'name', 'sites', 'values']),
    $defs: defs,
  };
}
