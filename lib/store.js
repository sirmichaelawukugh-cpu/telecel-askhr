const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

class Collection {
  constructor(file) {
    this.file = file;
  }

  _load() { return readJSON(this.file); }
  _save(data) { writeJSON(this.file, data); }

  find(query = {}) {
    let items = this._load();
    if (query._id) items = items.filter(i => i._id === query._id);
    if (query.username) items = items.filter(i => i.username === query.username);
    if (query.status) items = items.filter(i => i.status === query.status);
    if (query.priority) {
      if (query.priority.$in) items = items.filter(i => query.priority.$in.includes(i.priority));
      else items = items.filter(i => i.priority === query.priority);
    }
    if (query.department) items = items.filter(i => i.department === query.department);
    if (query.category) items = items.filter(i => i.category === query.category);
    if (query.$or) {
      items = items.filter(i => query.$or.some(cond => {
        for (const [k, re] of Object.entries(cond)) {
          if (re instanceof RegExp && re.test(i[k] || '')) return true;
        }
        return false;
      }));
    }
    return items;
  }

  findOne(query = {}) {
    return this.find(query)[0] || null;
  }

  findById(id) {
    return this._load().find(i => i._id === id) || null;
  }

  create(doc) {
    const data = this._load();
    const now = new Date().toISOString();
    const item = { _id: newId(), ...doc, createdAt: now, updatedAt: now };
    data.push(item);
    this._save(data);
    return item;
  }

  findByIdAndUpdate(id, update) {
    const data = this._load();
    const idx = data.findIndex(i => i._id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    Object.assign(data[idx], update, { updatedAt: now });
    this._save(data);
    return data[idx];
  }

  findByIdAndDelete(id) {
    const data = this._load();
    const idx = data.findIndex(i => i._id === id);
    if (idx === -1) return null;
    const [removed] = data.splice(idx, 1);
    this._save(data);
    return removed;
  }

  countDocuments(query = {}) {
    return this.find(query).length;
  }

  excludeFields(items, fields) {
    return items.map(item => {
      const copy = { ...item };
      fields.forEach(f => delete copy[f]);
      return copy;
    });
  }

  sort(items, key, dir = -1) {
    return items.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
}

const tickets = new Collection('tickets.json');
const users = new Collection('users.json');

module.exports = { tickets, users, newId };
