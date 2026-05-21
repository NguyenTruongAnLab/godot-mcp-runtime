import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { OperationParams, ToolDefinition, ToolResponse } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateProjectArgs,
  validateSubPath,
  createErrorResponse,
  getErrorMessage,
} from '../utils/godot-runner.js';

// --- Tool definitions ---

export const scriptToolDefinitions: ToolDefinition[] = [
  {
    name: 'list_script_elements',
    description:
      'Extract variables, functions, and signal declarations from a GDScript (.gd) file as structured JSON. Use to inspect the structure of a script before editing it surgically. No Godot process required. Returns: { functions: [{ name, params, returnType, line, isStatic }], signals: [{ name, params, line }], variables: [{ name, declaration, line, exported }] }.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scriptPath: {
          type: 'string',
          description: 'Path to the GDScript file relative to the project root (e.g. "scripts/player.gd")',
        },
      },
      required: ['projectPath', 'scriptPath'],
    },
  },
  {
    name: 'add_script_variable',
    description:
      'Add a new variable/property declaration to a GDScript file, after existing variables or below the extends/class_name header. Uses Godot 3 export syntax when exported is true. No Godot process required. Returns plain-text confirmation on success. Errors if variable already exists.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scriptPath: { type: 'string', description: 'Path to the GDScript file relative to the project root' },
        varName: { type: 'string', description: 'Name of the variable to add' },
        type: { type: 'string', description: 'Optional type annotation (e.g. "float", "int", "String")' },
        defaultValue: { type: 'string', description: 'Optional default value expression (e.g. "5.0", "true", "\\"hello\\"")' },
        exported: { type: 'boolean', description: 'Whether to export the variable (Godot 3 export keyword)' },
      },
      required: ['projectPath', 'scriptPath', 'varName'],
    },
  },
  {
    name: 'add_script_signal',
    description:
      'Add a new custom signal declaration to a GDScript file, after existing signals or below the extends/class_name header. No Godot process required. Returns plain-text confirmation on success. Errors if signal already exists.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scriptPath: { type: 'string', description: 'Path to the GDScript file relative to the project root' },
        signalName: { type: 'string', description: 'Name of the signal to add' },
        params: { type: 'string', description: 'Optional signal parameter names as a comma-separated list (e.g. "body, value")' },
      },
      required: ['projectPath', 'scriptPath', 'signalName'],
    },
  },
  {
    name: 'add_script_function',
    description:
      'Append a new function and its tab-indented body to the end of a GDScript file. No Godot process required. Returns plain-text confirmation on success. Errors if function already exists.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scriptPath: { type: 'string', description: 'Path to the GDScript file relative to the project root' },
        funcName: { type: 'string', description: 'Name of the function to add' },
        params: { type: 'string', description: 'Optional function parameter list string (e.g. "delta: float, speed := 5.0")' },
        body: { type: 'string', description: 'Body code of the function. Standard lines, will be tab-indented automatically.' },
        returnType: { type: 'string', description: 'Optional return type annotation (e.g. "void", "bool")' },
        isStatic: { type: 'boolean', description: 'Whether to declare the function as static' },
      },
      required: ['projectPath', 'scriptPath', 'funcName', 'body'],
    },
  },
  {
    name: 'remove_script_function',
    description:
      'Surgically remove a function and its entire indented body from a GDScript file by name. No Godot process required. Returns plain-text confirmation on success. Errors if function does not exist.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scriptPath: { type: 'string', description: 'Path to the GDScript file relative to the project root' },
        funcName: { type: 'string', description: 'Name of the function to remove' },
      },
      required: ['projectPath', 'scriptPath', 'funcName'],
    },
  },
];

// --- Structural Analysis & Manipulation Primitives ---

export interface ScriptFunction {
  name: string;
  params: string;
  returnType: string | null;
  line: number;
  isStatic: boolean;
}

export interface ScriptSignal {
  name: string;
  params: string;
  line: number;
}

export interface ScriptVariable {
  name: string;
  declaration: string;
  line: number;
  exported: boolean;
}

function resolveScriptPath(projectPath: string, scriptPath: string): string {
  const rel = scriptPath.startsWith('res://') ? scriptPath.slice(6) : scriptPath;
  return join(projectPath, rel);
}

export function parseScript(
  projectPath: string,
  scriptPath: string,
): { functions: ScriptFunction[]; signals: ScriptSignal[]; variables: ScriptVariable[] } {
  const fsPath = resolveScriptPath(projectPath, scriptPath);
  if (!existsSync(fsPath)) {
    throw new Error(`Script file not found: ${scriptPath}`);
  }
  const content = readFileSync(fsPath, 'utf8');
  const lines = content.split(/\r?\n/);

  const functions: ScriptFunction[] = [];
  const signals: ScriptSignal[] = [];
  const variables: ScriptVariable[] = [];

  const funcRe = /^(static\s+)?func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([\w\[\],? ]+))?\s*:/;
  const signalRe = /^signal\s+(\w+)\s*(?:\(([^)]*)\))?/;
  const varRe = /^(export\s*(?:\([^)]*\))?\s+)?(?:var|const)\s+(\w+)(?:\s*[:=].+)?/;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    const fm = trimmed.match(funcRe);
    if (fm) {
      functions.push({
        name: fm[2],
        params: (fm[3] ?? '').trim(),
        returnType: fm[4]?.trim() ?? null,
        line: i + 1,
        isStatic: !!fm[1],
      });
      continue;
    }

    const sm = trimmed.match(signalRe);
    if (sm) {
      signals.push({
        name: sm[1],
        params: (sm[2] ?? '').trim(),
        line: i + 1,
      });
      continue;
    }

    // Only capture top-level variables/constants (no leading spaces/tabs)
    if (!lines[i].match(/^\s/) && trimmed.match(varRe)) {
      const vm = trimmed.match(varRe)!;
      variables.push({
        name: vm[2],
        declaration: trimmed,
        line: i + 1,
        exported: !!vm[1],
      });
    }
  }

  return { functions, signals, variables };
}

function insertAtTopLevel(content: string, declaration: string, kind: 'signal' | 'var'): string {
  const lines = content.split(/\r?\n/);
  let insertAfter = -1;
  let firstFunc = lines.length;
  let lastExtends = 0;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (t.startsWith('extends ') || t.startsWith('class_name ')) {
      lastExtends = i;
    }
    if (t.startsWith('signal ') && kind === 'signal') {
      insertAfter = i;
    }
    if ((t.startsWith('var ') || t.startsWith('export ') || t.startsWith('const ')) && kind === 'var') {
      insertAfter = i;
    }
    if (t.match(/^(?:static\s+)?func\s+/) && !lines[i].match(/^\s/)) {
      firstFunc = Math.min(firstFunc, i);
    }
  }

  let pos: number;
  if (insertAfter >= 0) {
    pos = insertAfter + 1;
  } else if (firstFunc < lines.length) {
    pos = firstFunc;
  } else {
    pos = lastExtends + 1;
  }

  const newLines = [...lines.slice(0, pos), declaration, ...lines.slice(pos)];
  return newLines.join('\n');
}

// --- Handlers ---

export async function handleListScriptElements(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.scriptPath || typeof args.scriptPath !== 'string') {
    return createErrorResponse('scriptPath is required', ['Provide a script path inside the project root']);
  }
  if (!validateSubPath(v.projectPath, args.scriptPath)) {
    return createErrorResponse('Invalid scriptPath', ['Path must reside within the project root']);
  }

  try {
    const data = parseScript(v.projectPath, args.scriptPath);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to parse script: ${getErrorMessage(error)}`, [
      'Check if the file path is correct',
      'Verify the script is a valid GDScript file',
    ]);
  }
}

export async function handleAddScriptVariable(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.scriptPath || typeof args.scriptPath !== 'string') {
    return createErrorResponse('scriptPath is required', ['Provide a script path inside the project']);
  }
  if (!validateSubPath(v.projectPath, args.scriptPath)) {
    return createErrorResponse('Invalid scriptPath', ['Path must reside within the project root']);
  }
  if (!args.varName || typeof args.varName !== 'string' || !/^\w+$/.test(args.varName)) {
    return createErrorResponse('Valid varName is required', ['Provide a valid GDScript variable name']);
  }

  try {
    const fsPath = resolveScriptPath(v.projectPath, args.scriptPath);
    if (!existsSync(fsPath)) {
      return createErrorResponse(`Script file does not exist: ${args.scriptPath}`);
    }
    const content = readFileSync(fsPath, 'utf8');

    if (new RegExp(`^(export\\s*(?:\\([^)]*\\))?\\s+)?(?:var|const)\\s+${args.varName}\\b`, 'm').test(content)) {
      return createErrorResponse(`Variable "${args.varName}" already exists in the script`);
    }

    let decl = 'var ' + args.varName;
    if (args.type) decl += `: ${args.type}`;
    if (args.defaultValue !== undefined) decl += ` = ${args.defaultValue}`;
    if (args.exported === true) {
      decl = 'export ' + decl;
    }

    const newContent = insertAtTopLevel(content, decl, 'var');
    writeFileSync(fsPath, newContent, 'utf8');

    return { content: [{ type: 'text', text: `Successfully added variable "${decl}" to ${args.scriptPath}` }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to add variable: ${getErrorMessage(error)}`);
  }
}

export async function handleAddScriptSignal(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.scriptPath || typeof args.scriptPath !== 'string') {
    return createErrorResponse('scriptPath is required', ['Provide a script path inside the project']);
  }
  if (!validateSubPath(v.projectPath, args.scriptPath)) {
    return createErrorResponse('Invalid scriptPath', ['Path must reside within the project root']);
  }
  if (!args.signalName || typeof args.signalName !== 'string' || !/^\w+$/.test(args.signalName)) {
    return createErrorResponse('Valid signalName is required', ['Provide a valid GDScript signal name']);
  }

  try {
    const fsPath = resolveScriptPath(v.projectPath, args.scriptPath);
    if (!existsSync(fsPath)) {
      return createErrorResponse(`Script file does not exist: ${args.scriptPath}`);
    }
    const content = readFileSync(fsPath, 'utf8');

    if (new RegExp(`^signal\\s+${args.signalName}\\b`, 'm').test(content)) {
      return createErrorResponse(`Signal "${args.signalName}" already exists in the script`);
    }

    const decl = args.params && (args.params as string).trim()
      ? `signal ${args.signalName}(${args.params})`
      : `signal ${args.signalName}`;

    const newContent = insertAtTopLevel(content, decl, 'signal');
    writeFileSync(fsPath, newContent, 'utf8');

    return { content: [{ type: 'text', text: `Successfully added signal "${decl}" to ${args.scriptPath}` }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to add signal: ${getErrorMessage(error)}`);
  }
}

export async function handleAddScriptFunction(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.scriptPath || typeof args.scriptPath !== 'string') {
    return createErrorResponse('scriptPath is required', ['Provide a script path inside the project']);
  }
  if (!validateSubPath(v.projectPath, args.scriptPath)) {
    return createErrorResponse('Invalid scriptPath', ['Path must reside within the project root']);
  }
  if (!args.funcName || typeof args.funcName !== 'string' || !/^\w+$/.test(args.funcName)) {
    return createErrorResponse('Valid funcName is required', ['Provide a valid GDScript function name']);
  }
  if (args.body === undefined || typeof args.body !== 'string') {
    return createErrorResponse('Function body is required', ['Provide a function body string']);
  }

  try {
    const fsPath = resolveScriptPath(v.projectPath, args.scriptPath);
    if (!existsSync(fsPath)) {
      return createErrorResponse(`Script file does not exist: ${args.scriptPath}`);
    }
    const content = readFileSync(fsPath, 'utf8');

    if (new RegExp(`^(static\\s+)?func\\s+${args.funcName}\\s*\\(`, 'm').test(content)) {
      return createErrorResponse(`Function "${args.funcName}" already exists in the script`);
    }

    const returnPart = args.returnType ? ` -> ${args.returnType}` : '';
    const prefix = args.isStatic === true ? 'static ' : '';
    const header = `${prefix}func ${args.funcName}(${args.params ?? ''})${returnPart}:`;

    const bodyLines = (args.body as string)
      .split(/\r?\n/)
      .map((l) => (l.trim() === '' ? '' : `\t${l}`));

    if (bodyLines.every((l) => l.trim() === '')) {
      bodyLines.push('\tpass');
    }

    const existingTrimmed = content.trimEnd();
    const newContent = existingTrimmed + '\n\n' + header + '\n' + bodyLines.join('\n') + '\n';
    writeFileSync(fsPath, newContent, 'utf8');

    return { content: [{ type: 'text', text: `Successfully appended function "${args.funcName}" to ${args.scriptPath}` }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to add function: ${getErrorMessage(error)}`);
  }
}

export async function handleRemoveScriptFunction(_runner: any, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.scriptPath || typeof args.scriptPath !== 'string') {
    return createErrorResponse('scriptPath is required', ['Provide a script path inside the project']);
  }
  if (!validateSubPath(v.projectPath, args.scriptPath)) {
    return createErrorResponse('Invalid scriptPath', ['Path must reside within the project root']);
  }
  if (!args.funcName || typeof args.funcName !== 'string') {
    return createErrorResponse('funcName is required', ['Provide a function name to remove']);
  }

  try {
    const fsPath = resolveScriptPath(v.projectPath, args.scriptPath);
    if (!existsSync(fsPath)) {
      return createErrorResponse(`Script file does not exist: ${args.scriptPath}`);
    }
    const content = readFileSync(fsPath, 'utf8');
    const lines = content.split(/\r?\n/);

    const startRe = new RegExp(`^(static\\s+)?func\\s+${args.funcName}\\s*\\(`);
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().match(startRe) && !lines[i].match(/^\s+/)) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) {
      return createErrorResponse(`Function "${args.funcName}" not found in the script`);
    }

    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0 || line === '\r') continue;
      if (!line.match(/^\s/)) {
        endIdx = i;
        break;
      }
    }

    let removeFrom = startIdx;
    while (removeFrom > 0 && lines[removeFrom - 1].trim() === '') {
      removeFrom--;
    }

    const newLines = [...lines.slice(0, removeFrom), ...lines.slice(endIdx)];
    writeFileSync(fsPath, newLines.join('\n'), 'utf8');

    return { content: [{ type: 'text', text: `Successfully removed function "${args.funcName}" from ${args.scriptPath}` }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to remove function: ${getErrorMessage(error)}`);
  }
}
