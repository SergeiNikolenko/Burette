import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMvsStory, validateMvsStory } from './mvs-story.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_TEMPLATES = 64;
const MAX_TEMPLATE_BYTES = 1024 * 1024;
const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,63}$/u;
const PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,63})\}\}/gu;

export function defaultMvsStoryTemplateRoot() {
  const candidates = [
    resolve(__dirname, '..', 'templates', 'mvs-story'),
    resolve(__dirname, '..', 'assets', 'mvs-story-templates'),
  ];
  return candidates.find(candidate => existsSync(candidate)) || candidates[0];
}

export async function listMvsStoryTemplates({ templateRoot = defaultMvsStoryTemplateRoot() } = {}) {
  const templates = await loadTemplateCatalog(templateRoot);
  return templates.map(template => ({
    id: template.id,
    title: template.title,
    summary: template.summary,
    category: template.category,
    scientificUse: template.scientificUse,
    variables: template.variables,
    storyboard: template.storyboard,
    caveats: template.caveats,
  }));
}

export async function instantiateMvsStoryTemplate(templateId, variables = {}, options = {}) {
  const id = requiredString(templateId, 'Template id', 128);
  const templates = await loadTemplateCatalog(options.templateRoot || defaultMvsStoryTemplateRoot());
  const template = templates.find(candidate => candidate.id === id);
  if (!template) {
    throw templateError('TEMPLATE_NOT_FOUND', `Unknown MolViewSpec Story template: ${id}`, {
      availableTemplateIds: templates.map(candidate => candidate.id),
    });
  }
  if (!isObject(variables)) throw templateError('INVALID_TEMPLATE_VARIABLES', 'Template variables must be an object.');
  const definitions = new Map(template.variables.map(variable => [variable.name, variable]));
  const unknown = Object.keys(variables).filter(name => !definitions.has(name));
  if (unknown.length > 0) {
    throw templateError('UNKNOWN_TEMPLATE_VARIABLE', `Unknown variable${unknown.length === 1 ? '' : 's'} for ${id}: ${unknown.join(', ')}`, { unknown });
  }
  const values = {};
  for (const variable of template.variables) {
    const supplied = variables[variable.name];
    const value = supplied == null || supplied === '' ? variable.default : supplied;
    if ((value == null || value === '') && variable.required) {
      throw templateError('MISSING_TEMPLATE_VARIABLE', `Template ${id} requires variable: ${variable.name}`, { variable: variable.name });
    }
    if (value != null) values[variable.name] = requiredString(value, `Template variable ${variable.name}`, variable.maxLength || 4096);
  }
  const storySpec = substituteTemplateValue(template.story, values);
  const unresolved = collectPlaceholders(storySpec);
  if (unresolved.length > 0) {
    throw templateError('MISSING_TEMPLATE_VARIABLE', `Template ${id} has unresolved variables: ${unresolved.join(', ')}`, { unresolved });
  }
  const story = buildMvsStory(storySpec, options.now ? { now: options.now } : {});
  const validation = validateMvsStory(story);
  if (!validation.ok) {
    throw templateError('INVALID_STORY_TEMPLATE', `Template ${id} produced an invalid MolViewSpec Story.`, { issues: validation.issues.slice(0, 50) });
  }
  return {
    template: {
      id: template.id,
      title: template.title,
      summary: template.summary,
      caveats: template.caveats,
    },
    variables: values,
    story,
    summary: validation.summary,
    warnings: validation.warnings,
  };
}

async function loadTemplateCatalog(templateRoot) {
  let files;
  try {
    files = (await readdir(templateRoot)).filter(file => file.endsWith('.json')).sort();
  } catch (error) {
    throw templateError('TEMPLATE_CATALOG_UNAVAILABLE', `Could not read MolViewSpec Story templates: ${error?.message || String(error)}`);
  }
  if (files.length === 0) throw templateError('TEMPLATE_CATALOG_EMPTY', 'No MolViewSpec Story templates are installed.');
  if (files.length > MAX_TEMPLATES) throw templateError('TEMPLATE_CATALOG_TOO_LARGE', `Template catalog exceeds ${MAX_TEMPLATES} files.`);
  const templates = [];
  const ids = new Set();
  for (const file of files) {
    const source = await readFile(resolve(templateRoot, file));
    if (source.byteLength > MAX_TEMPLATE_BYTES) throw templateError('TEMPLATE_TOO_LARGE', `Story template exceeds ${MAX_TEMPLATE_BYTES} bytes: ${file}`);
    let template;
    try {
      template = JSON.parse(source.toString('utf8'));
    } catch (error) {
      throw templateError('INVALID_STORY_TEMPLATE', `Could not parse Story template ${file}: ${error?.message || String(error)}`);
    }
    validateTemplateDescriptor(template, file);
    if (ids.has(template.id)) throw templateError('DUPLICATE_TEMPLATE_ID', `Duplicate Story template id: ${template.id}`);
    ids.add(template.id);
    templates.push(template);
  }
  return templates;
}

function validateTemplateDescriptor(template, file) {
  if (!isObject(template) || template.schema !== 'burette_mvs_story_template.v1') {
    throw templateError('INVALID_STORY_TEMPLATE', `${file} must use schema burette_mvs_story_template.v1.`);
  }
  requiredString(template.id, `${file} id`, 128);
  requiredString(template.title, `${file} title`, 512);
  requiredString(template.summary, `${file} summary`, 4096);
  requiredString(template.category, `${file} category`, 128);
  requiredString(template.scientificUse, `${file} scientificUse`, 4096);
  if (!Array.isArray(template.variables)) throw templateError('INVALID_STORY_TEMPLATE', `${file} variables must be an array.`);
  if (!Array.isArray(template.storyboard) || template.storyboard.length === 0) throw templateError('INVALID_STORY_TEMPLATE', `${file} storyboard must be a non-empty array.`);
  if (!Array.isArray(template.caveats) || template.caveats.length === 0) throw templateError('INVALID_STORY_TEMPLATE', `${file} caveats must be a non-empty array.`);
  if (!isObject(template.story)) throw templateError('INVALID_STORY_TEMPLATE', `${file} story must be an object.`);
  const names = new Set();
  for (const variable of template.variables) {
    if (!isObject(variable) || !VARIABLE_NAME.test(variable.name || '')) throw templateError('INVALID_STORY_TEMPLATE', `${file} has an invalid variable name.`);
    if (names.has(variable.name)) throw templateError('INVALID_STORY_TEMPLATE', `${file} repeats variable ${variable.name}.`);
    names.add(variable.name);
    requiredString(variable.description, `${file} variable description`, 2048);
    if (typeof variable.required !== 'boolean') throw templateError('INVALID_STORY_TEMPLATE', `${file} variable ${variable.name} must declare required.`);
  }
  const placeholders = collectPlaceholders(template.story);
  const undeclared = placeholders.filter(name => !names.has(name));
  if (undeclared.length > 0) throw templateError('INVALID_STORY_TEMPLATE', `${file} uses undeclared variables: ${undeclared.join(', ')}.`);
}

function substituteTemplateValue(value, variables) {
  if (typeof value === 'string') return value.replace(PLACEHOLDER, (_, name) => variables[name] ?? `{{${name}}}`);
  if (Array.isArray(value)) return value.map(item => substituteTemplateValue(item, variables));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substituteTemplateValue(child, variables)]));
}

function collectPlaceholders(value) {
  const names = new Set();
  const visit = child => {
    if (typeof child === 'string') {
      for (const match of child.matchAll(PLACEHOLDER)) names.add(match[1]);
      return;
    }
    if (Array.isArray(child)) return child.forEach(visit);
    if (isObject(child)) Object.values(child).forEach(visit);
  };
  visit(value);
  return [...names].sort();
}

function requiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw templateError('INVALID_STORY_TEMPLATE', `${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength) throw templateError('INVALID_STORY_TEMPLATE', `${label} exceeds ${maxLength} characters.`);
  return result;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function templateError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
