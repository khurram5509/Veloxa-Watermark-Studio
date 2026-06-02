const fs = require('node:fs');
const crypto = require('node:crypto');
const { profilesFile } = require('./paths');

const STARTER_PROFILES = [
  {
    id: 'company-confidential',
    name: 'Company Confidential',
    type: 'text',
    text: 'CONFIDENTIAL',
    logoPath: '',
    fontFamily: 'Helvetica',
    fontSize: 72,
    fontColor: '#C8102E',
    bold: true,
    italic: false,
    opacity: 0.18,
    rotation: -30,
    position: 'center',
    scale: 1,
    margin: 48,
    pages: 'all',
    customPages: '',
    namingTemplate: '{originalname}_CONFIDENTIAL_{counter}',
    isDefault: true,
  },
  {
    id: 'draft-version',
    name: 'Draft Version',
    type: 'text',
    text: 'DRAFT',
    logoPath: '',
    fontFamily: 'Helvetica',
    fontSize: 96,
    fontColor: '#6B7280',
    bold: true,
    italic: true,
    opacity: 0.15,
    rotation: -45,
    position: 'center',
    scale: 1,
    margin: 48,
    pages: 'all',
    customPages: '',
    namingTemplate: '{originalname}_DRAFT_{counter}',
    isDefault: false,
  },
  {
    id: 'internal-distribution',
    name: 'Internal Distribution',
    type: 'text',
    text: 'INTERNAL USE ONLY',
    logoPath: '',
    fontFamily: 'Helvetica',
    fontSize: 56,
    fontColor: '#1F3DF5',
    bold: true,
    italic: false,
    opacity: 0.20,
    rotation: -30,
    position: 'diagonal',
    scale: 1,
    margin: 48,
    pages: 'all',
    customPages: '',
    namingTemplate: '{originalname}_INTERNAL_{counter}',
    isDefault: false,
  },
  {
    id: 'approved-copy',
    name: 'Approved Copy',
    type: 'text',
    text: 'APPROVED',
    logoPath: '',
    fontFamily: 'Helvetica',
    fontSize: 72,
    fontColor: '#16A34A',
    bold: true,
    italic: false,
    opacity: 0.22,
    rotation: -30,
    position: 'center',
    scale: 1,
    margin: 48,
    pages: 'all',
    customPages: '',
    namingTemplate: '{originalname}_APPROVED_{counter}',
    isDefault: false,
  },
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(profilesFile(), 'utf8'));
    if (!Array.isArray(cache)) throw new Error('bad profile file');
  } catch {
    // First install or corrupt file — seed starters so the user has something
    // to look at. We deliberately do NOT reseed when the file exists with an
    // empty array — that's a legitimate "I deleted them all" state and the
    // user should be allowed to keep it that way (UI will show empty state
    // and prompt them to create a new profile).
    cache = JSON.parse(JSON.stringify(STARTER_PROFILES));
    persist();
  }
  return cache;
}

function persist() {
  fs.writeFileSync(profilesFile(), JSON.stringify(cache, null, 2), 'utf8');
}

const list = () => load().slice();
const get = (id) => load().find((p) => p.id === id) || null;
const getDefault = () => load().find((p) => p.isDefault) || load()[0] || null;

function save(profile) {
  load();
  const id = profile.id || crypto.randomUUID();
  const next = { ...profile, id };
  const idx = cache.findIndex((p) => p.id === id);
  if (idx >= 0) cache[idx] = next;
  else cache.push(next);
  if (next.isDefault) cache.forEach((p) => { if (p.id !== id) p.isDefault = false; });
  persist();
  return next;
}

function remove(id) {
  load();
  cache = cache.filter((p) => p.id !== id);
  persist();
  return true;
}

function duplicate(id) {
  const src = get(id);
  if (!src) return null;
  const copy = { ...src, id: crypto.randomUUID(), name: `${src.name} (Copy)`, isDefault: false };
  cache.push(copy);
  persist();
  return copy;
}

function setDefault(id) {
  load();
  cache.forEach((p) => { p.isDefault = p.id === id; });
  persist();
  return cache.find((p) => p.id === id) || null;
}

function exportTo(id, dest) {
  const p = get(id);
  if (!p) return null;
  fs.writeFileSync(dest, JSON.stringify(p, null, 2), 'utf8');
  return dest;
}

function importFrom(src) {
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  data.id = crypto.randomUUID();
  data.isDefault = false;
  load();
  cache.push(data);
  persist();
  return data;
}

module.exports = { list, get, getDefault, save, remove, duplicate, setDefault, exportTo, importFrom };
