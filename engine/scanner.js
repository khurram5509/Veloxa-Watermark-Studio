const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SUPPORTED = new Set(['.pdf', '.docx', '.pptx']);

async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile()) {
      if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
}

/**
 * Scan a list of input paths (mix of files and folders).
 *
 * Returns:
 *   {
 *     files:     [string]   // unique, supported files found anywhere in input
 *     hadFolder: boolean    // true if at least one input path was a directory
 *     byType:    { '.pdf': [...], '.docx': [...], '.pptx': [...] }
 *   }
 *
 * The renderer uses `hadFolder` to decide whether to show the "import all /
 * import only X" picker — explicit file selections skip the picker, folder
 * scans show it.
 */
async function scanPaths(paths) {
  const result = [];
  let hadFolder = false;
  for (const p of paths || []) {
    try {
      const stat = await fsp.stat(p);
      if (stat.isDirectory()) {
        hadFolder = true;
        await walk(p, result);
      } else if (stat.isFile() && SUPPORTED.has(path.extname(p).toLowerCase())) {
        result.push(p);
      }
    } catch {
      /* skip missing paths */
    }
  }
  const files = Array.from(new Set(result));
  const byType = { '.pdf': [], '.docx': [], '.pptx': [] };
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (byType[ext]) byType[ext].push(f);
  }
  return { files, hadFolder, byType };
}

module.exports = { scanPaths, SUPPORTED };
