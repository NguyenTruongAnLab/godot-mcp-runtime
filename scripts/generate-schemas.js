import { writeFileSync } from 'fs';
import { join } from 'path';
import { allToolDefinitions } from '../dist/index.js';

const targetDir = 'C:\\Users\\nguytruo\\.gemini\\antigravity-ide\\mcp\\godot';

console.log(`Writing ${allToolDefinitions.length} tool schemas to ${targetDir}...`);

for (const tool of allToolDefinitions) {
  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
  const filePath = join(targetDir, `${tool.name}.json`);
  writeFileSync(filePath, JSON.stringify(schema), 'utf8');
  console.log(`Wrote ${tool.name}.json`);
}

console.log('All schemas successfully updated!');
