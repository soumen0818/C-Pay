const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'App/src');
const sensitiveKeywords = ['pin', 'token', 'secret', 'seed', 'payload', 'tx', 'transaction', 'key', 'auth', 'password', 'mnemonic'];

function processFile(filePath) {
  if (!filePath.match(/\.(ts|tsx)$/) || filePath.includes('logger.ts')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  let hasChanges = false;
  let hasLoggerImport = content.includes('import { Logger }');

  const lines = content.split('\n');
  let newLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.includes('console.')) {
      const lowerLine = line.toLowerCase();
      const isSensitive = sensitiveKeywords.some(kw => lowerLine.includes(kw));
      
      if (isSensitive) {
        newLines.push('// [SECURITY] Removed sensitive log: ' + line.trim().replace(/\*/g, ''));
        hasChanges = true;
        continue;
      } else {
        line = line.replace(/console\.(log|error|warn|info|debug)/g, (match, level) => {
          if (level === 'log') return 'Logger.info';
          return 'Logger.' + level;
        });
        hasChanges = true;
      }
    }
    newLines.push(line);
  }

  if (hasChanges) {
    let finalContent = newLines.join('\n');
    
    if (!hasLoggerImport) {
      const relativeDepth = filePath.replace(dir, '').split(path.sep).length - 2;
      let importPath = '';
      if (relativeDepth === 0) importPath = './utils/logger';
      else if (relativeDepth === 1) importPath = '../utils/logger';
      else if (relativeDepth === 2) importPath = '../../utils/logger';
      else if (relativeDepth === 3) importPath = '../../../utils/logger';
      
      if (filePath.includes('utils') && relativeDepth === 1) importPath = './logger';
      if (filePath.includes('hooks') && relativeDepth === 1) importPath = '../utils/logger';
      if (filePath.includes('services') && relativeDepth === 1) importPath = '../utils/logger';
      if (filePath.includes('components') && relativeDepth === 1) importPath = '../utils/logger';
      if (filePath.includes('components') && relativeDepth === 2) importPath = '../../utils/logger';
      
      finalContent = "import { Logger } from '" + importPath + "';\n" + finalContent;
    }
    
    fs.writeFileSync(filePath, finalContent, 'utf8');
    console.log('Updated ' + filePath);
  }
}

function walkDir(d) {
  const files = fs.readdirSync(d);
  for (const f of files) {
    const fullPath = path.join(d, f);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else {
      processFile(fullPath);
    }
  }
}

walkDir(dir);

# Automated fix for issue #223: USDC migration hardcodes the testnet issuer for every user
