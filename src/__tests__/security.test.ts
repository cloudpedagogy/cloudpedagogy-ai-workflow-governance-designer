import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, sanitizeUrl } from '../utils/security';

describe('Security Utilities', () => {
  describe('escapeHtml', () => {
    it('escapes standard HTML special characters', () => {
      const input = '<div class="test" data-val=\'sample\'>Tom & Jerry</div>';
      const output = escapeHtml(input);
      expect(output).toBe('&lt;div class=&quot;test&quot; data-val=&#39;sample&#39;&gt;Tom &amp; Jerry&lt;/div&gt;');
    });

    it('neutralizes malicious script tags', () => {
      const xss = '<script>alert("XSS")</script>';
      const safe = escapeHtml(xss);
      expect(safe).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(safe).not.toContain('<script>');
    });

    it('neutralizes inline event handlers in attributes', () => {
      const payload = '"><img src=x onerror=alert(1)>';
      const safe = escapeAttr(payload);
      expect(safe).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
      expect(safe).not.toContain('">');
    });

    it('handles null and undefined gracefully', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('converts non-string primitives safely', () => {
      expect(escapeHtml(12345)).toBe('12345');
      expect(escapeHtml(true)).toBe('true');
      expect(escapeHtml(0)).toBe('0');
    });
  });

  describe('sanitizeUrl', () => {
    it('permits safe https and http URLs', () => {
      expect(sanitizeUrl('https://cloudpedagogy.com')).toBe('https://cloudpedagogy.com');
      expect(sanitizeUrl('http://example.com/spec')).toBe('http://example.com/spec');
    });

    it('permits relative paths and in-page anchors', () => {
      expect(sanitizeUrl('./assets/style.css')).toBe('./assets/style.css');
      expect(sanitizeUrl('/dashboard')).toBe('/dashboard');
      expect(sanitizeUrl('#section-2')).toBe('#section-2');
    });

    it('permits valid data URIs for json and markdown exports', () => {
      const dataJson = 'data:application/json;charset=utf-8,%7B%7D';
      const dataMd = 'data:text/markdown;charset=utf-8,%23%20Spec';
      expect(sanitizeUrl(dataJson)).toBe(dataJson);
      expect(sanitizeUrl(dataMd)).toBe(dataMd);
    });

    it('neutralizes javascript: schemes', () => {
      expect(sanitizeUrl('javascript:alert(document.cookie)')).toBe('#unsafe-url-blocked');
      expect(sanitizeUrl('JAVASCRIPT:void(0)')).toBe('#unsafe-url-blocked');
      expect(sanitizeUrl('  javascript:alert(1)  ')).toBe('#unsafe-url-blocked');
    });

    it('neutralizes vbscript: and dangerous data: schemes', () => {
      expect(sanitizeUrl('vbscript:msgbox("test")')).toBe('#unsafe-url-blocked');
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#unsafe-url-blocked');
    });

    it('14. rejects protocol-relative external URLs beginning with // while preserving valid relative and https URLs', () => {
      expect(sanitizeUrl('//evil.example.com/payload.js')).toBe('#unsafe-url-blocked');
      expect(sanitizeUrl('   //attacker.org/phish  ')).toBe('#unsafe-url-blocked');
      expect(sanitizeUrl('/local/path')).toBe('/local/path');
      expect(sanitizeUrl('./relative/file.json')).toBe('./relative/file.json');
      expect(sanitizeUrl('https://www.cloudpedagogy.com/')).toBe('https://www.cloudpedagogy.com/');
    });
  });
});
