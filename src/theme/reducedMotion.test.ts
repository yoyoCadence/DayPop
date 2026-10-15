/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DP-168 — every movement in the App's CSS stops when the person asks for
 * reduced motion.
 *
 * Read statically from the stylesheets, as `textContrast.test.ts` reads the
 * palettes: jsdom applies no media queries, so a rendered test could not tell.
 * An `animation` other than `none`, or a `transition` that moves something
 * (transform, position, size), needs the same selector set to `none` inside a
 * `@media (prefers-reduced-motion: reduce)` block in the same file — or has to
 * be written inside `prefers-reduced-motion: no-preference` in the first
 * place. A colour fading is not motion and may stay. The 2026-10-13 review found the calendar
 * manager's switch knob still sliding; this is what would have caught it.
 */

/**
 * Every stylesheet under `src`, as text, keyed by its path. Read from disk:
 * Vitest hands CSS imports to tests as empty strings, `?raw` included.
 */
const SOURCE = join(process.cwd(), 'src');
const STYLESHEETS: Record<string, string> = Object.fromEntries(
  cssFiles(SOURCE).map((file) => [relative(SOURCE, file), readFileSync(file, 'utf8')]),
);

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}
const MOVING = /\b(transform|translate|left|right|top|bottom|width|height|margin|inset|all)\b/;

interface Rule {
  selectors: string[];
  body: string;
  /** Inside `prefers-reduced-motion: reduce` — where motion is switched off. */
  reducedMotion: boolean;
  /** Inside `prefers-reduced-motion: no-preference` — motion only for those who did not ask otherwise. */
  motionAllowed: boolean;
}

/** Rules with their selectors, and whether they sit in a reduced-motion block. */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  function walk(chunk: string, reducedMotion: boolean, motionAllowed: boolean) {
    let index = 0;
    while (index < chunk.length) {
      const open = chunk.indexOf('{', index);
      if (open < 0) return;
      const prelude = chunk.slice(index, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < chunk.length && depth > 0) {
        if (chunk[close] === '{') depth += 1;
        if (chunk[close] === '}') depth -= 1;
        close += 1;
      }
      const body = chunk.slice(open + 1, close - 1);
      if (prelude.startsWith('@media')) {
        walk(
          body,
          reducedMotion || /prefers-reduced-motion:\s*reduce/.test(prelude),
          motionAllowed || /prefers-reduced-motion:\s*no-preference/.test(prelude),
        );
      } else if (!prelude.startsWith('@')) {
        found.push({
          selectors: prelude.split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
          body,
          reducedMotion,
          motionAllowed,
        });
      }
      index = close;
    }
  }
  walk(text, false, false);
  return found;
}

function declaration(body: string, property: 'animation' | 'transition'): string | null {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match ? match[1]!.trim() : null;
}

/** What moves and is not stopped under reduced motion, as `file: selector → value`. */
function unguardedMotion(): string[] {
  const problems: string[] = [];
  for (const [file, css] of Object.entries(STYLESHEETS)) {
    const all = rules(css);
    const stopped = (selector: string, property: 'animation' | 'transition') =>
      all.some(
        (rule) =>
          rule.reducedMotion &&
          rule.selectors.includes(selector) &&
          declaration(rule.body, property) === 'none',
      );
    for (const rule of all.filter((candidate) => !candidate.reducedMotion && !candidate.motionAllowed)) {
      const animation = declaration(rule.body, 'animation');
      const transition = declaration(rule.body, 'transition');
      for (const selector of rule.selectors) {
        if (animation && animation !== 'none' && !stopped(selector, 'animation')) {
          problems.push(`${file}: ${selector} → animation: ${animation}`);
        }
        if (transition && MOVING.test(transition) && !stopped(selector, 'transition')) {
          problems.push(`${file}: ${selector} → transition: ${transition}`);
        }
      }
    }
  }
  return problems;
}

describe('reduced motion (DP-168)', () => {
  it('stops every animation and every moving transition when reduced motion is asked for', () => {
    expect(unguardedMotion()).toEqual([]);
  });

  it('reads the rules it guards, so an empty result means something', () => {
    const animated = Object.values(STYLESHEETS).flatMap((css) =>
      rules(css).filter(
        (rule) => !rule.reducedMotion && (declaration(rule.body, 'animation') ?? 'none') !== 'none',
      ),
    );
    expect(animated.length).toBeGreaterThanOrEqual(7);
  });
});
