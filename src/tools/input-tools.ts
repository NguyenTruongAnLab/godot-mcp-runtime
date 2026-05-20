import { readFileSync, writeFileSync } from 'fs';
import type { OperationParams, ToolDefinition, ToolResponse } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateProjectArgs,
  createErrorResponse,
  getErrorMessage,
  projectGodotPath,
} from '../utils/godot-runner.js';

// --- Tool definitions ---

export const inputToolDefinitions: ToolDefinition[] = [
  {
    name: 'list_input_actions',
    description:
      'List all custom input actions and their key bindings defined in project.godot under the [input] section. No Godot process required. Returns: [{ name, deadzone, events: [{ type, key, scancode }] }].',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'add_input_action',
    description:
      'Add a new custom input action to project.godot, optionally binding a standard keyboard key (e.g. "Space", "Shift", "w", "a", "s", "d", "Left", "Right"). Automatically handles Godot 3 serialization for standard key events. No Godot process required. Returns plain-text confirmation on success. Errors if action already exists.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        actionName: {
          type: 'string',
          description: 'Name of the input action to add (e.g. "ui_dash")',
        },
        key: {
          type: 'string',
          description: 'Optional key to bind (e.g. "Shift", "Space", "w", "ArrowLeft")',
        },
        deadzone: { type: 'number', description: 'Action deadzone value (default: 0.5)' },
      },
      required: ['projectPath', 'actionName'],
    },
  },
  {
    name: 'remove_input_action',
    description:
      'Remove a custom input action and all its key bindings from project.godot. No Godot process required. Returns plain-text confirmation on success. Errors if action does not exist.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        actionName: { type: 'string', description: 'Name of the input action to remove' },
      },
      required: ['projectPath', 'actionName'],
    },
  },
];

// --- Helper Functions ---

function getScancode(key: string): number {
  const k = key.toLowerCase().trim();
  const specialKeys: Record<string, number> = {
    space: 32,
    shift: 16777237,
    left_shift: 16777237,
    right_shift: 16777238,
    ctrl: 16777238,
    control: 16777238,
    left_control: 16777238,
    right_control: 16777239,
    alt: 16777240,
    left_alt: 16777240,
    right_alt: 16777241,
    enter: 16777221,
    escape: 16777217,
    left: 16777231,
    arrowleft: 16777231,
    up: 16777232,
    arrowup: 16777232,
    right: 16777233,
    arrowright: 16777233,
    down: 16777234,
    arrowdown: 16777234,
    tab: 16777218,
    backspace: 16777219,
  };

  if (specialKeys[k] !== undefined) return specialKeys[k];
  if (k.length === 1) {
    return k.toUpperCase().charCodeAt(0);
  }
  const parsed = parseInt(k, 10);
  if (!isNaN(parsed)) return parsed;
  throw new Error(`Unknown key: "${key}"`);
}

function parseEvents(eventsStr: string): Array<{ type: string; key?: string; scancode?: number }> {
  const parsed: Array<{ type: string; key?: string; scancode?: number }> = [];
  const eventRe =
    /Object\(InputEventKey,"resource_local_to_scene":\w+,"resource_name":"[^"]*","device":\d+,"alt":\w+,"shift":\w+,"control":\w+,"meta":\w+,"command":\w+,"pressed":\w+,"scancode":(\d+)/g;
  let match;
  while ((match = eventRe.exec(eventsStr)) !== null) {
    const scancode = parseInt(match[1], 10);
    parsed.push({ type: 'InputEventKey', scancode });
  }
  return parsed;
}

// --- Handlers ---

export async function handleListInputActions(
  _runner: any,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  try {
    const projectFile = projectGodotPath(v.projectPath);
    const content = readFileSync(projectFile, 'utf8');

    const inputSectionIdx = content.indexOf('[input]');
    if (inputSectionIdx === -1) {
      return { content: [{ type: 'text', text: '[]' }] };
    }

    // Extract everything from [input] to next [ section
    const afterInput = content.substring(inputSectionIdx);
    const nextSectionIdx = afterInput.indexOf('\n[', 1);
    const inputSectionContent =
      nextSectionIdx === -1 ? afterInput : afterInput.substring(0, nextSectionIdx);

    const actions: Array<{ name: string; deadzone: number; events: any[] }> = [];
    const actionRe = /^(\w+)\s*=\s*\{([\s\S]*?)\}/gm;
    let match;
    while ((match = actionRe.exec(inputSectionContent)) !== null) {
      const name = match[1];
      const inner = match[2];

      const deadzoneMatch = inner.match(/"deadzone":\s*([\d.]+)/);
      const deadzone = deadzoneMatch ? parseFloat(deadzoneMatch[1]) : 0.5;

      const eventsMatch = inner.match(/"events":\s*\[([\s\S]*?)\]/);
      const eventsStr = eventsMatch ? eventsMatch[1] : '';
      const events = parseEvents(eventsStr);

      actions.push({ name, deadzone, events });
    }

    return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to list input actions: ${getErrorMessage(error)}`);
  }
}

export async function handleAddInputAction(
  _runner: any,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.actionName || typeof args.actionName !== 'string' || !/^\w+$/.test(args.actionName)) {
    return createErrorResponse('Valid actionName is required', [
      'Provide a valid input action name',
    ]);
  }

  try {
    const projectFile = projectGodotPath(v.projectPath);
    const content = readFileSync(projectFile, 'utf8');

    // Check for duplicate
    const inputSectionIdx = content.indexOf('[input]');
    if (inputSectionIdx !== -1) {
      const afterInput = content.substring(inputSectionIdx);
      const nextSectionIdx = afterInput.indexOf('\n[', 1);
      const inputSectionContent =
        nextSectionIdx === -1 ? afterInput : afterInput.substring(0, nextSectionIdx);

      if (new RegExp(`^${args.actionName}\\s*=`, 'm').test(inputSectionContent)) {
        return createErrorResponse(`Input action "${args.actionName}" already exists`);
      }
    }

    const deadzone = typeof args.deadzone === 'number' ? args.deadzone : 0.5;
    let eventStr = '';

    if (args.key && typeof args.key === 'string') {
      const scancode = getScancode(args.key);
      eventStr = ` Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":0,"alt":false,"shift":false,"control":false,"meta":false,"command":false,"pressed":false,"scancode":${scancode},"physical_scancode":0,"unicode":0,"echo":false,"script":null)\n `;
    }

    const actionEntry = `${args.actionName}={\n"deadzone": ${deadzone.toFixed(1)},\n"events": [${eventStr}]\n}`;

    const lines = content.split(/\r?\n/);
    const sectionIdx = lines.findIndex((l) => l.trim() === '[input]');

    if (sectionIdx === -1) {
      // Append section to end
      const newContent = content.trimEnd() + '\n\n[input]\n\n' + actionEntry + '\n';
      writeFileSync(projectFile, newContent, 'utf8');
    } else {
      // Insert right after [input] header
      lines.splice(sectionIdx + 1, 0, '', actionEntry);
      writeFileSync(projectFile, lines.join('\n'), 'utf8');
    }

    return {
      content: [{ type: 'text', text: `Successfully added input action "${args.actionName}"` }],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to add input action: ${getErrorMessage(error)}`);
  }
}

export async function handleRemoveInputAction(
  _runner: any,
  args: OperationParams,
): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  if (!args.actionName || typeof args.actionName !== 'string') {
    return createErrorResponse('actionName is required', [
      'Provide the input action name to remove',
    ]);
  }

  try {
    const projectFile = projectGodotPath(v.projectPath);
    const content = readFileSync(projectFile, 'utf8');

    const inputSectionIdx = content.indexOf('[input]');
    if (inputSectionIdx === -1) {
      return createErrorResponse(`No [input] section found in project.godot`);
    }

    const afterInput = content.substring(inputSectionIdx);
    const nextSectionIdx = afterInput.indexOf('\n[', 1);
    const inputSectionContent =
      nextSectionIdx === -1 ? afterInput : afterInput.substring(0, nextSectionIdx);

    const actionRegex = new RegExp(`^${args.actionName}\\s*=\\s*\\{[\\s\\S]*?\\}\\r?\\n`, 'm');
    if (!actionRegex.test(inputSectionContent)) {
      return createErrorResponse(`Input action "${args.actionName}" not found`);
    }

    const updatedSectionContent = inputSectionContent.replace(actionRegex, '');
    const beforeInput = content.substring(0, inputSectionIdx);
    const sectionEnd = nextSectionIdx === -1 ? '' : afterInput.substring(nextSectionIdx);

    const newContent = beforeInput + updatedSectionContent + sectionEnd;
    writeFileSync(projectFile, newContent, 'utf8');

    return {
      content: [{ type: 'text', text: `Successfully removed input action "${args.actionName}"` }],
    };
  } catch (error: unknown) {
    return createErrorResponse(`Failed to remove input action: ${getErrorMessage(error)}`);
  }
}
