import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageInfo: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
if (packageInfo === null || typeof packageInfo !== 'object' || !('version' in packageInfo)
  || typeof packageInfo.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(packageInfo.version)) {
  throw new Error('Invalid application version metadata.');
}
const gitOptions = { cwd: new URL('.', import.meta.url), encoding: 'utf8' as const };
const sha = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid application build identity.');
const modified = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], gitOptions).trim() !== '';

export default defineConfig({
  plugins: [react()],
  define: {
    __PGM_BUILD__: JSON.stringify({ version: packageInfo.version, sha, builtAt: new Date().toISOString(), modified }),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
  },
});
