const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { logsFile } = require('./paths');

const events = new EventEmitter();
events.setMaxListeners(50);

const buffer = [];
const MAX_BUFFER = 2000;

function load() {
  if (buffer.length) return;
  try {
    const raw = fs.readFileSync(logsFile(), 'utf8');
    raw.split(/\r?\n/).filter(Boolean).slice(-MAX_BUFFER).forEach((line) => {
      try { buffer.push(JSON.parse(line)); } catch {}
    });
  } catch {}
}

function append(entry) {
  load();
  const line = { ts: Date.now(), ...entry };
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  try {
    fs.appendFileSync(logsFile(), JSON.stringify(line) + '\n', 'utf8');
  } catch {}
  events.emit('line', line);
  return line;
}

const log = (level, message, meta = {}) => append({ level, message, ...meta });

module.exports = {
  events,
  list: (limit = 500) => {
    load();
    return buffer.slice(-limit);
  },
  clear: () => {
    buffer.length = 0;
    try { fs.writeFileSync(logsFile(), '', 'utf8'); } catch {}
  },
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  success: (msg, meta) => log('success', msg, meta),
};
