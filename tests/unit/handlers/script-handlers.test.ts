import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  handleListScriptElements,
  handleAddScriptVariable,
  handleAddScriptSignal,
  handleAddScriptFunction,
  handleRemoveScriptFunction,
} from '../../../src/tools/script-tools.js';
import { hasError, expectErrorMatching } from '../../helpers/assertions.js';
import { useTmpDirs } from '../../helpers/tmp.js';

const tmp = useTmpDirs();

function makeTmpProjectWithScript(scriptContent: string): { dir: string; scriptPath: string } {
  const dir = tmp.makeProject('mcp-script-test-');
  const scriptPath = 'scripts/test.gd';
  const fullPath = join(dir, scriptPath);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(fullPath, scriptContent, 'utf8');
  return { dir, scriptPath };
}

describe('Script Handlers', () => {
  describe('handleListScriptElements', () => {
    it('rejects missing parameters', async () => {
      const result = await handleListScriptElements(null, {});
      expect(hasError(result)).toBe(true);
    });

    it('extracts functions, signals, and variables', async () => {
      const code = `extends Node
class_name TestNode

signal my_signal(a, b)

export var speed: float = 5.0
var active := true

func _ready():
\tpass

static func calculate(val) -> int:
\treturn 42
`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);
      const result = await handleListScriptElements(null, {
        projectPath: dir,
        scriptPath,
      });

      expect(hasError(result)).toBe(false);
      const data = JSON.parse(result.content[0].text!);

      expect(data.signals).toHaveLength(1);
      expect(data.signals[0].name).toBe('my_signal');
      expect(data.signals[0].params).toBe('a, b');

      expect(data.variables).toHaveLength(2);
      expect(data.variables[0].name).toBe('speed');
      expect(data.variables[0].exported).toBe(true);
      expect(data.variables[1].name).toBe('active');
      expect(data.variables[1].exported).toBe(false);

      expect(data.functions).toHaveLength(2);
      expect(data.functions[0].name).toBe('_ready');
      expect(data.functions[1].name).toBe('calculate');
      expect(data.functions[1].isStatic).toBe(true);
      expect(data.functions[1].returnType).toBe('int');
    });
  });

  describe('handleAddScriptVariable', () => {
    it('adds exported and normal variables correctly', async () => {
      const code = `extends Node\n`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      // Add normal variable
      const res1 = await handleAddScriptVariable(null, {
        projectPath: dir,
        scriptPath,
        varName: 'my_var',
        type: 'int',
        defaultValue: '10',
      });
      expect(hasError(res1)).toBe(false);

      // Add exported variable
      const res2 = await handleAddScriptVariable(null, {
        projectPath: dir,
        scriptPath,
        varName: 'my_exported',
        type: 'String',
        defaultValue: '"hello"',
        exported: true,
      });
      expect(hasError(res2)).toBe(false);

      const content = readFileSync(join(dir, scriptPath), 'utf8');
      expect(content).toContain('var my_var: int = 10');
      expect(content).toContain('export var my_exported: String = "hello"');
    });

    it('rejects duplicate variables', async () => {
      const code = `extends Node\nvar speed = 10\n`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      const result = await handleAddScriptVariable(null, {
        projectPath: dir,
        scriptPath,
        varName: 'speed',
      });
      expect(hasError(result)).toBe(true);
      expectErrorMatching(result, /already exists/i);
    });
  });

  describe('handleAddScriptSignal', () => {
    it('adds custom signals correctly', async () => {
      const code = `extends Node\n`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      const res = await handleAddScriptSignal(null, {
        projectPath: dir,
        scriptPath,
        signalName: 'custom_triggered',
        params: 'val, magnitude',
      });
      expect(hasError(res)).toBe(false);

      const content = readFileSync(join(dir, scriptPath), 'utf8');
      expect(content).toContain('signal custom_triggered(val, magnitude)');
    });

    it('rejects duplicate signals', async () => {
      const code = `extends Node\nsignal my_sig\n`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      const result = await handleAddScriptSignal(null, {
        projectPath: dir,
        scriptPath,
        signalName: 'my_sig',
      });
      expect(hasError(result)).toBe(true);
    });
  });

  describe('handleAddScriptFunction', () => {
    it('appends function to end of file and auto-indents body', async () => {
      const code = `extends Node\n\nfunc _ready():\n\tpass\n`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      const res = await handleAddScriptFunction(null, {
        projectPath: dir,
        scriptPath,
        funcName: 'test_func',
        params: 'arg1: float',
        body: 'print(arg1)\nif arg1 > 0:\n\treturn true',
        returnType: 'bool',
      });
      expect(hasError(res)).toBe(false);

      const content = readFileSync(join(dir, scriptPath), 'utf8');
      expect(content).toContain('func test_func(arg1: float) -> bool:');
      expect(content).toContain('\tprint(arg1)\n\tif arg1 > 0:\n\t\treturn true');
    });
  });

  describe('handleRemoveScriptFunction', () => {
    it('removes function and body correctly', async () => {
      const code = `extends Node

func delete_me():
\tprint("yes")
\tpass

func keep_me():
\tpass
`;
      const { dir, scriptPath } = makeTmpProjectWithScript(code);

      const res = await handleRemoveScriptFunction(null, {
        projectPath: dir,
        scriptPath,
        funcName: 'delete_me',
      });
      expect(hasError(res)).toBe(false);

      const content = readFileSync(join(dir, scriptPath), 'utf8');
      expect(content).not.toContain('func delete_me():');
      expect(content).not.toContain('print("yes")');
      expect(content).toContain('func keep_me():');
    });
  });
});
