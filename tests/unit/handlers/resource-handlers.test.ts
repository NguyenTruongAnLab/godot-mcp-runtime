import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  handleCreateTresResource,
  handleApplySpatialMaterial,
} from '../../../src/tools/resource-tools.js';
import { createFakeRunner } from '../../helpers/fake-runner.js';
import { hasError, expectErrorMatching } from '../../helpers/assertions.js';
import { fixtureProjectPath } from '../../helpers/fixture-paths.js';
import { useTmpDirs } from '../../helpers/tmp.js';

const tmp = useTmpDirs();

describe('Resource Handlers', () => {
  describe('handleCreateTresResource', () => {
    it('rejects missing parameters', async () => {
      const result = await handleCreateTresResource(null, {});
      expect(hasError(result)).toBe(true);
    });

    it('creates StyleBoxFlat resource with standard properties', async () => {
      const dir = tmp.makeProject('mcp-resource-test-');
      const resourcePath = 'my_stylebox.tres';

      const result = await handleCreateTresResource(null, {
        projectPath: dir,
        resourcePath,
        type: 'StyleBoxFlat',
        properties: {
          bg_color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 },
          corner_radius_top_left: 8,
          shadow_size: 4,
          anti_aliasing: true,
        },
      });

      expect(hasError(result)).toBe(false);
      const fsPath = join(dir, resourcePath);
      expect(existsSync(fsPath)).toBe(true);

      const content = readFileSync(fsPath, 'utf8');
      expect(content).toContain('[gd_resource type="StyleBoxFlat" format=2]');
      expect(content).toContain('bg_color = Color( 0.1, 0.2, 0.3, 0.8 )');
      expect(content).toContain('corner_radius_top_left = 8');
      expect(content).toContain('shadow_size = 4');
      expect(content).toContain('anti_aliasing = true');
    });

    it('creates SpatialMaterial resource with standard properties', async () => {
      const dir = tmp.makeProject('mcp-resource-test-');
      const resourcePath = 'res://my_material.tres';

      const result = await handleCreateTresResource(null, {
        projectPath: dir,
        resourcePath,
        type: 'SpatialMaterial',
        properties: {
          albedo_color: { r: 1.0, g: 0.0, b: 0.0 },
          metallic: 0.5,
          roughness: 0.4,
          albedo_texture: 'ExtResource( 1 )',
        },
      });

      expect(hasError(result)).toBe(false);
      const fsPath = join(dir, 'my_material.tres');
      expect(existsSync(fsPath)).toBe(true);

      const content = readFileSync(fsPath, 'utf8');
      expect(content).toContain('[gd_resource type="SpatialMaterial" format=2]');
      expect(content).toContain('albedo_color = Color( 1, 0, 0, 1 )');
      expect(content).toContain('metallic = 0.5');
      expect(content).toContain('roughness = 0.4');
      expect(content).toContain('albedo_texture = ExtResource( 1 )');
    });
  });

  describe('handleApplySpatialMaterial', () => {
    it('rejects missing scenePath', async () => {
      const fake = createFakeRunner();
      const result = await handleApplySpatialMaterial(fake.asRunner, {
        projectPath: fixtureProjectPath,
        nodePath: 'root/Mesh',
        materialPath: 'shiny.tres',
      });
      expectErrorMatching(result, /scenePath/i);
    });

    it('delegates to executeSceneOp and returns success on valid output', async () => {
      const dir = tmp.makeProject('mcp-resource-test-');
      const materialPath = 'shiny.tres';
      writeFileSync(
        join(dir, materialPath),
        '[gd_resource type="SpatialMaterial" format=2]',
        'utf8',
      );
      writeFileSync(join(dir, 'scene.tscn'), '[gd_scene format=2]', 'utf8');

      const fake = createFakeRunner({ stdout: 'Material successfully applied to scene node' });
      const result = await handleApplySpatialMaterial(fake.asRunner, {
        projectPath: dir,
        scenePath: 'scene.tscn',
        nodePath: 'root/Mesh',
        materialPath,
        surfaceIndex: 0,
      });

      expect(hasError(result)).toBe(false);
      const text = result.content[0].text!;
      expect(text).toContain('applied to scene node');

      // Verify operation arguments passed to the fake runner
      expect(fake.calls[0].operation).toBe('apply_spatial_material');
      expect(fake.calls[0].params.surfaceIndex).toBe(0);
      expect(fake.calls[0].params.materialPath).toBe('shiny.tres');
    });
  });
});
