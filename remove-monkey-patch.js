const fs = require('fs');
const content = fs.readFileSync('api/index.js', 'utf8');

// Remove the monkey-patch middleware (lines 94-103)
const lines = content.split('\n');
const newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Start skipping at the monkey-patch
  if (line.trim() === 'app.use((req, res, next) => {') {
    const nextLine = lines[i+1];
    if (nextLine && nextLine.includes('originalJson = res.json.bind(res)')) {
      skip = true;
    }
  }
  
  if (!skip) {
    newLines.push(line);
  }
  
  // Stop skipping after the closing });
  if (skip && line.trim() === '});') {
    skip = false;
    // Also skip the empty line after
    if (i+1 < lines.length && lines[i+1].trim() === '') {
      // skip next empty line too
      i++;
    }
    continue;
  }
}

fs.writeFileSync('api/index.js', newLines.join('\n'));
console.log('Removed monkey-patch');