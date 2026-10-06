const fs = require('fs');
const content = fs.readFileSync('api/index.js', 'utf8');

// Fix the broken lines - lines 94-95 have extra "next(); });"
const lines = content.split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Skip the broken "next(); });" line
  if (line.trim() === 'next();' && i+1 < lines.length && lines[i+1].trim() === '});') {
    console.log('Skipping broken lines at', i+1, i+2);
    continue;
  }
  // Also skip the following "});" 
  if (line.trim() === '});' && i > 0 && lines[i-1].trim() === 'next();') {
    console.log('Skipping extra }); at', i+1);
    continue;
  }
  
  newLines.push(line);
}

fs.writeFileSync('api/index.js', newLines.join('\n'));
console.log('Fixed');