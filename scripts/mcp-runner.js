import { GodotRunner } from '../dist/utils/godot-runner.js';
import { dispatchToolCall } from '../dist/dispatch.js';

const runner = new GodotRunner();
await runner.detectGodotPath();

const [toolName, ...argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error("Usage: node mcp-runner.js <tool_name> '<args_json>'");
  process.exit(1);
}

const args = argsJson.length > 0 ? JSON.parse(argsJson.join(' ')) : {};

console.log(`Running tool ${toolName} with args:`, args);
try {
  const result = await dispatchToolCall(runner, toolName, args);
  console.log("SUCCESS:", JSON.stringify(result, null, 2));
} catch (error) {
  console.error("FAILURE:", error);
}
