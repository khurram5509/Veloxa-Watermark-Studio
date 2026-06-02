const path = require('node:path');
const { processPdf } = require('./pdf');
const { processDocx } = require('./docx');
const { processPptx } = require('./pptx');

async function process({ inputPath, outputPath, profile, settings }) {
  const ext = path.extname(inputPath).toLowerCase();
  switch (ext) {
    case '.pdf':  return processPdf({ inputPath, outputPath, profile, settings });
    case '.docx': return processDocx({ inputPath, outputPath, profile, settings });
    case '.pptx': return processPptx({ inputPath, outputPath, profile, settings });
    default:      throw new Error(`Unsupported file type: ${ext}`);
  }
}

module.exports = { process };
