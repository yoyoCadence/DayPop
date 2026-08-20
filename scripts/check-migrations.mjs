import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural lint for `supabase/migrations/*.sql`.
 *
 * CI never builds a database, so a migration that does not parse reaches review
 * — an `IF EXISTS (...)` with one bracket too many did exactly that in DP-056.
 * This is not a SQL parser and does not pretend to be one; it catches the
 * bracket, quote and block mistakes that hand-written PL/pgSQL actually makes,
 * which is the class of error that got through.
 *
 * String literals, dollar-quoted bodies and `--` comments are stripped before
 * counting, so an apostrophe or a bracket inside text never trips it.
 */

const DIR = 'supabase/migrations';

/** Removes comments and literals, keeping newlines so line numbers survive. */
function strip(sql) {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      const chunk = sql.slice(index, end === -1 ? sql.length : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      index = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[index] === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") end += 2;
        else if (sql[end] === "'") break;
        else end += 1;
      }
      const chunk = sql.slice(index, Math.min(end + 1, sql.length));
      out += chunk.replace(/[^\n]/g, ' ');
      index = end + 1;
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      if (end === -1) return { text: out, unterminated: tag };
      const chunk = sql.slice(index, end + tag.length);
      // Function bodies are checked on their own, below.
      out += chunk.replace(/[^\n]/g, ' ');
      index = end + tag.length;
      continue;
    }

    out += sql[index];
    index += 1;
  }
  return { text: out, unterminated: null };
}

/** Every `$$ ... $$` body in the file, with the line it starts on. */
function bodies(sql) {
  const found = [];
  const pattern = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const tag = match[0];
    const close = sql.indexOf(tag, match.index + tag.length);
    if (close === -1) break;
    found.push({
      line: sql.slice(0, match.index).split('\n').length,
      text: sql.slice(match.index + tag.length, close),
    });
    pattern.lastIndex = close + tag.length;
  }
  return found;
}

function balance(text) {
  let depth = 0;
  let line = 1;
  for (const character of text) {
    if (character === '\n') line += 1;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) return { depth, line };
    }
  }
  return { depth, line: null };
}

const problems = [];

for (const name of readdirSync(DIR).filter((file) => file.endsWith('.sql')).sort()) {
  const path = join(DIR, name);
  const sql = readFileSync(path, 'utf8');

  const stripped = strip(sql);
  if (stripped.unterminated) {
    problems.push(`${name}: unterminated dollar-quoted block opened with ${stripped.unterminated}`);
    continue;
  }

  const outer = balance(stripped.text);
  if (outer.depth !== 0) {
    problems.push(
      outer.line
        ? `${name}: unmatched ")" at line ${outer.line}`
        : `${name}: ${outer.depth} unclosed "(" outside function bodies`,
    );
  }

  for (const body of bodies(sql)) {
    const inner = strip(body.text);
    const result = balance(inner.text);
    if (result.depth !== 0) {
      const at = result.line ? body.line + result.line - 1 : null;
      problems.push(
        at !== null
          ? `${name}: unmatched ")" at line ${at} (inside the body starting at line ${body.line})`
          : `${name}: ${result.depth} unclosed "(" in the body starting at line ${body.line}`,
      );
    }

    // Every `begin`, `if`, `case` and `loop` closes with exactly one `end`
    // token (`end;`, `end if`, `end case`, `end loop`), so counting openers
    // against `end` catches a missing or surplus one. `elsif`/`else` are not
    // openers. Counted on the stripped body, so keywords inside strings and
    // comments do not register.
    const words = inner.text.toLowerCase().match(/[a-z_]+/g) ?? [];
    let open = 0;
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (word === 'end') open -= 1;
      else if (word === 'begin' || word === 'case' || word === 'loop') open += 1;
      else if (word === 'if' && words[i - 1] !== 'end') open += 1;
    }
    if (open !== 0) {
      problems.push(
        `${name}: ${open > 0 ? open + ' unclosed' : -open + ' extra'} begin/if/case block(s) in the body starting at line ${body.line}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('Migration check failed:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const count = readdirSync(DIR).filter((file) => file.endsWith('.sql')).length;
console.log(`Migration check passed: ${count} files, brackets and blocks balanced.`);
