import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  handleListInputActions,
  handleAddInputAction,
  handleRemoveInputAction,
} from '../../../src/tools/input-tools.js';
import { hasError } from '../../helpers/assertions.js';
import { useTmpDirs } from '../../helpers/tmp.js';

const tmp = useTmpDirs();

function makeTmpProjectWithInput(inputContent: string): string {
  const dir = tmp.makeProject('mcp-input-test-');
  const projectFile = join(dir, 'project.godot');
  const content = `config_version=4\n\n${inputContent}\n`;
  writeFileSync(projectFile, content, 'utf8');
  return dir;
}

describe('Input Action Handlers', () => {
  describe('handleListInputActions', () => {
    it('returns empty array when no [input] section is defined', async () => {
      const dir = makeTmpProjectWithInput('');
      const res = await handleListInputActions(null, { projectPath: dir });
      expect(hasError(res)).toBe(false);
      expect(JSON.parse(res.content[0].text!)).toEqual([]);
    });

    it('extracts input actions and key events properly', async () => {
      const ini = `[input]

ui_dash={
"deadzone": 0.6,
"events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":0,"alt":false,"shift":false,"control":false,"meta":false,"command":false,"pressed":false,"scancode":16777237,"physical_scancode":0,"unicode":0,"echo":false,"script":null)
 ]
}`;
      const dir = makeTmpProjectWithInput(ini);
      const res = await handleListInputActions(null, { projectPath: dir });
      expect(hasError(res)).toBe(false);

      const parsed = JSON.parse(res.content[0].text!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('ui_dash');
      expect(parsed[0].deadzone).toBe(0.6);
      expect(parsed[0].events).toHaveLength(1);
      expect(parsed[0].events[0].type).toBe('InputEventKey');
      expect(parsed[0].events[0].scancode).toBe(16777237); // Shift
    });
  });

  describe('handleAddInputAction', () => {
    it('creates [input] section and inserts action when not present', async () => {
      const dir = makeTmpProjectWithInput('');
      const res = await handleAddInputAction(null, {
        projectPath: dir,
        actionName: 'jump',
        key: 'Space',
        deadzone: 0.7,
      });

      expect(hasError(res)).toBe(false);
      const content = readFileSync(join(dir, 'project.godot'), 'utf8');
      expect(content).toContain('[input]');
      expect(content).toContain('jump={');
      expect(content).toContain('"deadzone": 0.7');
      expect(content).toContain('"scancode":32'); // Space
    });

    it('rejects duplicate input actions', async () => {
      const ini = `[input]\njump={\n"deadzone": 0.5,\n"events": []\n}`;
      const dir = makeTmpProjectWithInput(ini);

      const res = await handleAddInputAction(null, {
        projectPath: dir,
        actionName: 'jump',
      });
      expect(hasError(res)).toBe(true);
    });
  });

  describe('handleRemoveInputAction', () => {
    it('removes action cleanly from project.godot', async () => {
      const ini = `[input]
jump={
"deadzone": 0.5,
"events": []
}
ui_dash={
"deadzone": 0.5,
"events": []
}`;
      const dir = makeTmpProjectWithInput(ini);

      const res = await handleRemoveInputAction(null, {
        projectPath: dir,
        actionName: 'jump',
      });
      expect(hasError(res)).toBe(false);

      const content = readFileSync(join(dir, 'project.godot'), 'utf8');
      expect(content).not.toContain('jump={');
      expect(content).toContain('ui_dash={');
    });

    it('errors if action does not exist', async () => {
      const dir = makeTmpProjectWithInput('[input]\n');
      const res = await handleRemoveInputAction(null, {
        projectPath: dir,
        actionName: 'nonexistent',
      });
      expect(hasError(res)).toBe(true);
    });
  });
});
