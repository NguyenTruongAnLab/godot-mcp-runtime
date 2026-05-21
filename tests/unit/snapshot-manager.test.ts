import { describe, it, expect } from 'vitest';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { SnapshotManager, getAbsoluteScenePath } from '../../src/utils/snapshot-manager.js';
import { useTmpDirs } from '../helpers/tmp.js';

describe('SnapshotManager', () => {
  const tmp = useTmpDirs();

  describe('getAbsoluteScenePath', () => {
    it('resolves relative paths against the project directory', () => {
      const projectPath = 'C:\\my-project';
      const scenePath = 'scenes/main.tscn';
      const resolved = getAbsoluteScenePath(projectPath, scenePath);
      expect(resolved).toContain(join('C:\\my-project', 'scenes/main.tscn'));
    });

    it('removes res:// prefix before resolving', () => {
      const projectPath = 'C:\\my-project';
      const scenePath = 'res://scenes/main.tscn';
      const resolved = getAbsoluteScenePath(projectPath, scenePath);
      expect(resolved).toContain(join('C:\\my-project', 'scenes/main.tscn'));
    });
  });

  describe('backup and rollback workflow', () => {
    it('returns null if the target file does not exist', async () => {
      const projectPath = tmp.make();
      const backupPath = await SnapshotManager.createBackup(projectPath, 'nonexistent.tscn');
      expect(backupPath).toBeNull();
    });

    it('creates a valid backup and can successfully roll back', async () => {
      const projectPath = tmp.make();
      const sceneFile = 'level.tscn';
      const absoluteScenePath = join(projectPath, sceneFile);

      // Write initial scene content
      const originalContent = 'initial content';
      await fs.writeFile(absoluteScenePath, originalContent, 'utf8');

      // Create backup
      const backupPath = await SnapshotManager.createBackup(projectPath, sceneFile);
      expect(backupPath).not.toBeNull();
      expect(existsSync(backupPath!)).toBe(true);

      // Mutate the original file
      await fs.writeFile(absoluteScenePath, 'mutated content', 'utf8');

      // Rollback
      const rolledBack = await SnapshotManager.rollback(projectPath, sceneFile, backupPath!);
      expect(rolledBack).toBe(true);

      // Verify original content is restored
      const finalContent = await fs.readFile(absoluteScenePath, 'utf8');
      expect(finalContent).toBe(originalContent);

      // Verify the backup file was cleaned up/deleted post-rollback
      expect(existsSync(backupPath!)).toBe(false);
    });

    it('returns false when attempting to rollback using a nonexistent backup path', async () => {
      const projectPath = tmp.make();
      const rolledBack = await SnapshotManager.rollback(projectPath, 'level.tscn', 'nonexistent.bak');
      expect(rolledBack).toBe(false);
    });
  });

  describe('backup history pruning', () => {
    it('maintains a maximum rolling history of 20 backups per project', async () => {
      const projectPath = tmp.make();
      const sceneFile = 'level.tscn';
      const absoluteScenePath = join(projectPath, sceneFile);
      await fs.writeFile(absoluteScenePath, 'level content', 'utf8');

      // Generate 25 backups
      const backupPaths: string[] = [];
      for (let i = 0; i < 25; i++) {
        // Sleep slightly to guarantee distinct modified times if needed,
        // or just let them generate. We do a tiny delay to ensure timestamps increment.
        await new Promise((resolve) => setTimeout(resolve, 2));
        const path = await SnapshotManager.createBackup(projectPath, sceneFile);
        expect(path).not.toBeNull();
        backupPaths.push(path!);
      }

      // Check backup directory contents
      const backupDir = SnapshotManager.getBackupDir(projectPath);
      const remainingFiles = await fs.readdir(backupDir);
      const remainingBakFiles = remainingFiles.filter((f) => f.endsWith('.bak'));

      // Verify we only kept the most recent 20 backups
      expect(remainingBakFiles.length).toBe(20);

      // The first 5 backups should have been pruned and deleted
      for (let i = 0; i < 5; i++) {
        expect(existsSync(backupPaths[i])).toBe(false);
      }

      // The last 20 backups should still exist
      for (let i = 5; i < 25; i++) {
        expect(existsSync(backupPaths[i])).toBe(true);
      }
    });
  });
});
