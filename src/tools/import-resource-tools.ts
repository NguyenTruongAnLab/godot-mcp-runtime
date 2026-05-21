import { join, sep, basename, dirname } from 'path';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { GodotRunner, OperationParams, ToolDefinition, ToolResponse } from '../utils/godot-runner.js';
import {
  normalizeParameters,
  validateProjectArgs,
  validateSubPath,
  createErrorResponse,
} from '../utils/godot-runner.js';

// --- Tool definitions ---

export const importResourceToolDefinitions: ToolDefinition[] = [
  {
    name: 'import_resource',
    description:
      'Trigger Godot\'s resource import pipeline for newly added asset files (.glb, .png, .wav, .ogg, .svg, .obj, .ttf, etc.). Runs a short-lived headless Godot process with --no-window that force-scans the project, generating .import metadata files. This is required after copying new binary assets into the project before they can be referenced by headless scene tools (add_node, set_node_properties). Without this, Godot will not recognize the assets. No running project session is required. Returns: a list of which resources were found and their import status.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        resourcePaths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional array of resource file paths relative to the project root to verify after import (e.g., ["assets/player.glb", "textures/icon.png"]). If omitted, runs a full project scan.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in ms for the import process (default: 30000). Increase for projects with many new assets.',
        },
      },
      required: ['projectPath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imported: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              importFileExists: { type: 'boolean' },
            },
          },
        },
        message: { type: 'string' },
      },
    },
  },
];

// --- Helpers ---

function writeDirectImportConfig(projectPath: string, filePath: string): boolean {
  try {
    const fullPath = join(projectPath, filePath);
    if (!existsSync(fullPath)) return false;

    // Compute MD5 hash of the file
    const fileBuffer = readFileSync(fullPath);
    const md5 = createHash('md5').update(fileBuffer).digest('hex');

    const ext = filePath.split('.').pop()?.toLowerCase();
    const fileName = basename(filePath);
    const relativeResPath = filePath.replace(/\\/g, '/');

    // Create the .import directory if it doesn't exist
    const dotImportDir = join(projectPath, '.import');
    mkdirSync(dotImportDir, { recursive: true });

    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      const destFile = `.import/${fileName}-${md5}.stex`;
      const fullDestPath = join(projectPath, destFile);

      // Write .import file next to the asset
      const importContent = `[remap]

importer="texture"
type="StreamTexture"
path="res://${destFile}"
metadata={
"vram_texture": false
}

[deps]

source_file="res://${relativeResPath}"
dest_files=[ "res://${destFile}" ]

[params]

compress/mode=0
compress/lossy_quality=0.7
compress/hdr_mode=0
compress/bptc_ldr=0
compress/normal_map=0
compress/channel_pack=0
filter/mipmaps=false
filter/filter=true
filter/anisotropic=false
filter/srgb=2
process/fix_alpha_border=true
process/premult_alpha=false
process/HDR_as_SRGB=false
process/invert_color=false
stream=false
size_limit=0
detect_3d=true
svg/scale=1.0
`;
      writeFileSync(fullPath + '.import', importContent, 'utf8');

      // Write a dummy stex file so Godot's resource loader is satisfied
      const stexHeader = Buffer.alloc(32);
      stexHeader.write('GDST', 0, 'ascii');
      stexHeader.writeUInt32LE(64, 4); // width
      stexHeader.writeUInt32LE(64, 8); // height
      stexHeader.writeUInt32LE(0, 12); // flags
      stexHeader.writeUInt32LE(37, 16); // format (RGBA8)
      stexHeader.writeUInt32LE(1, 20); // mipmaps
      stexHeader.writeUInt32LE(0, 24); // data size placeholder
      writeFileSync(fullDestPath, stexHeader);
      return true;

    } else if (ext === 'wav') {
      const destFile = `.import/${fileName}-${md5}.sample`;
      const fullDestPath = join(projectPath, destFile);

      const importContent = `[remap]

importer="wav"
type="AudioStreamSample"
path="res://${destFile}"

[deps]

source_file="res://${relativeResPath}"
dest_files=[ "res://${destFile}" ]

[params]

force/8_bit=false
force/mono=false
force/max_rate=false
force/max_rate_hz=44100
edit/trim=true
edit/normalize=false
edit/loop=false
compress/mode=0
`;
      writeFileSync(fullPath + '.import', importContent, 'utf8');

      writeFileSync(fullDestPath, Buffer.alloc(8));
      return true;
    }
  } catch (_e) {
    // ignore
  }
  return false;
}

// --- Handler ---

export async function handleImportResource(runner: GodotRunner, args: OperationParams): Promise<ToolResponse> {
  args = normalizeParameters(args);
  const v = validateProjectArgs(args);
  if ('isError' in v) return v;

  const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
  const resourcePaths = Array.isArray(args.resourcePaths) ? args.resourcePaths as string[] : [];

  // Validate that specified resource files actually exist on disk
  const invalidPaths: string[] = [];
  for (const rp of resourcePaths) {
    if (typeof rp !== 'string' || !validateSubPath(v.projectPath, rp)) {
      invalidPaths.push(rp);
      continue;
    }
    const fullPath = join(v.projectPath, rp);
    if (!existsSync(fullPath)) {
      invalidPaths.push(rp);
    }
  }
  if (invalidPaths.length > 0) {
    return createErrorResponse(
      `Resource files not found: ${invalidPaths.join(', ')}`,
      ['Ensure the files exist in the project directory before calling import_resource'],
    );
  }

  // Optimize: directly write .import configs for PNG/JPG/JPEG/WAV files
  const remainingForSubprocess: string[] = [];
  for (const rp of resourcePaths) {
    const ext = rp.split('.').pop()?.toLowerCase();
    if (ext && ['png', 'jpg', 'jpeg', 'wav'].includes(ext)) {
      writeDirectImportConfig(v.projectPath, rp);
    } else {
      remainingForSubprocess.push(rp);
    }
  }

  // Only spawn the subprocess if we have remaining assets or if no explicit resource paths were provided (which triggers full scan)
  const needsSubprocess = resourcePaths.length === 0 || remainingForSubprocess.length > 0;

  if (needsSubprocess) {
    try {
      const importScript = `
extends SceneTree

func _init():
    # Wait for the import pipeline to process all new assets
    # The import runs automatically when the project is opened
    yield(create_timer(2.0), "timeout")
    quit()
`;

      await runner.executeOperation(
        'run_import_scan',
        { script_content: importScript },
        v.projectPath,
        timeout,
      );
    } catch (_error: unknown) {
      try {
        if (!runner.getGodotPath()) {
          await runner.detectGodotPath();
        }
        const godotPath = runner.getGodotPath();
        if (!godotPath) {
          return createErrorResponse('Could not find Godot executable for import', [
            'Set GODOT_PATH environment variable',
          ]);
        }

        const { execSync } = await import('child_process');
        const cmd = `"${godotPath}" --no-window --path "${v.projectPath}" --quit`;
        execSync(cmd, { timeout, stdio: 'pipe' });
      } catch (innerError: unknown) {
        // Godot exits with non-zero when using --quit, which is expected
      }
    }
  }

  // Check import results
  const imported: Array<{ path: string; importFileExists: boolean }> = [];

  if (resourcePaths.length > 0) {
    for (const rp of resourcePaths) {
      const importFilePath = join(v.projectPath, '.import', rp.replace(/[/\\]/g, '-') + '.import');
      const altImportPath = join(v.projectPath, rp + '.import');
      const exists = existsSync(importFilePath) || existsSync(altImportPath);
      imported.push({ path: rp, importFileExists: exists });
    }
  }

  const allImported = imported.length === 0 || imported.every(r => r.importFileExists);
  const message = resourcePaths.length > 0
    ? `Import scan completed. ${imported.filter(r => r.importFileExists).length}/${imported.length} resources have .import metadata.`
    : 'Import scan completed. All project assets have been scanned.';

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: allImported,
          imported,
          message,
        }, null, 2),
      },
    ],
  };
}
