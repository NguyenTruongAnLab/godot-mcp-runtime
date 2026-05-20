import { describe, it, expect } from 'vitest';
import { handleSetTilemapCell } from '../../../src/tools/tilemap-tools.js';
import { createFakeRunner } from '../../helpers/fake-runner.js';
import { hasError, expectErrorMatching } from '../../helpers/assertions.js';
import { fixtureProjectPath, fixtureScenePath } from '../../helpers/fixture-paths.js';

const validBase = {
  projectPath: fixtureProjectPath,
  scenePath: fixtureScenePath,
  nodePath: 'root/TileMap',
  x: 0,
  y: 0,
  tileId: 1,
};

describe('handleSetTilemapCell', () => {
  it('rejects missing projectPath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetTilemapCell(fake.asRunner, {
      scenePath: fixtureScenePath,
      nodePath: 'root/TileMap',
      x: 0,
      y: 0,
      tileId: 1,
    });
    expectErrorMatching(result, /projectPath/i);
  });

  it('rejects missing nodePath', async () => {
    const fake = createFakeRunner();
    const result = await handleSetTilemapCell(fake.asRunner, {
      projectPath: fixtureProjectPath,
      scenePath: fixtureScenePath,
      x: 0,
      y: 0,
      tileId: 1,
    });
    expectErrorMatching(result, /nodePath/i);
  });

  it('rejects missing coordinates or tileId', async () => {
    const fake = createFakeRunner();
    const resultX = await handleSetTilemapCell(fake.asRunner, {
      ...validBase,
      x: undefined,
    });
    expectErrorMatching(resultX, /x coordinate/i);

    const resultY = await handleSetTilemapCell(fake.asRunner, {
      ...validBase,
      y: undefined,
    });
    expectErrorMatching(resultY, /y coordinate/i);

    const resultTile = await handleSetTilemapCell(fake.asRunner, {
      ...validBase,
      tileId: undefined,
    });
    expectErrorMatching(resultTile, /tileId/i);
  });

  it('surfaces runner exceptions as a structured MCP error response', async () => {
    const fake = createFakeRunner({ throws: new Error('boom') });
    const result = await handleSetTilemapCell(fake.asRunner, validBase);
    expectErrorMatching(result, /boom/);
  });

  it('returns parsed result on successful runner output', async () => {
    const fake = createFakeRunner({
      stdout: 'TileMap cell at (0, 0) set to tile 1',
    });
    const result = await handleSetTilemapCell(fake.asRunner, validBase);
    expect(hasError(result)).toBe(false);
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('set to tile');
  });
});
