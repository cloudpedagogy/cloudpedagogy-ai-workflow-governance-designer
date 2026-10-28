import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Build Portability & Relative Asset Paths', () => {
  it('ensures production dist/index.html uses relative paths for all assets', () => {
    const distIndexPath = path.resolve(__dirname, '../../dist/index.html');

    // Verify build exists
    expect(fs.existsSync(distIndexPath)).toBe(true);

    const htmlContent = fs.readFileSync(distIndexPath, 'utf-8');

    // 1. Favicon must be relative (e.g. ./favicon.svg)
    expect(htmlContent).toMatch(/<link\s+rel="icon"[^>]+href="\.\/favicon\.svg"/);
    expect(htmlContent).not.toMatch(/href="\/favicon\.svg"/);

    // 2. JavaScript modules must use relative path (e.g. ./assets/...)
    expect(htmlContent).toMatch(/src="\.\/assets\/index-[^"]+\.js"/);
    expect(htmlContent).not.toMatch(/src="\/assets\//);

    // 3. Stylesheets must use relative path (e.g. ./assets/...)
    expect(htmlContent).toMatch(/href="\.\/assets\/index-[^"]+\.css"/);
    expect(htmlContent).not.toMatch(/href="\/assets\//);
  });
});
