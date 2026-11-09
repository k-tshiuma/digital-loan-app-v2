/**
 * Right-to-left text for pdfkit.
 *
 * pdfkit has no bidi support. It hands text to fontkit, which reverses a string when its first
 * letter is from a right-to-left script. That turns "בקשה 12" into "21 השקב" (wrong digits) and
 * leaves Latin-first lines with Hebrew inside unreversed. (By default pdfkit also splits text at
 * spaces and lays out each word separately; passing `features` makes it lay out the whole string.)
 * So we:
 *   1. break the paragraph into lines ourselves (measuring width, which does not depend on order);
 *   2. reorder each line into visual order with the Unicode bidi algorithm (bidi-js), mirroring
 *      brackets as needed;
 *   3. split the visual line into runs whose letters are all RTL or all LTR, pre-reverse the RTL
 *      runs (fontkit reverses them back) and draw the runs left to right.
 */
const bidiFactory = require('bidi-js');

const bidi = bidiFactory();

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u;
const ANY_LETTER = /\p{L}/u;
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;
const HEBREW = /[֐-׿]/;

/** True when fontkit will lay this string out right-to-left (its first letter is RTL). */
function fontkitReverses(text) {
  for (const ch of text) {
    if (RTL_LETTER.test(ch)) return true;
    if (ANY_LETTER.test(ch)) return false;
  }
  return false;
}

/** Reorder one line (no line breaks) from logical to visual order. */
function visualOrder(text, baseDir = 'rtl') {
  const str = String(text);
  if (!str) return str;
  // 'auto' lets the first strong letter decide (bidi-js does that when no direction is given).
  const embedding = bidi.getEmbeddingLevels(str, baseDir === 'auto' ? undefined : baseDir);
  const chars = str.split('');
  bidi.getMirroredCharactersMap(str, embedding.levels).forEach((replacement, index) => {
    chars[index] = replacement;
  });
  for (const [start, end] of bidi.getReorderSegments(str, embedding)) {
    const reversed = chars.slice(start, end + 1).reverse();
    chars.splice(start, reversed.length, ...reversed);
  }
  // Direction marks and isolates have done their job; the font has no glyphs for them.
  return chars.join('').replace(BIDI_CONTROLS, '');
}

/** Remove direction marks and isolates (for text drawn without bidi processing). */
function stripBidiControls(text) {
  return String(text).replace(BIDI_CONTROLS, '');
}

/** Keep a value left-to-right inside right-to-left text (phone numbers, IDs), like <bdi dir="ltr">. */
function ltr(value) {
  return value === undefined || value === null || value === '' ? value : `⁦${value}⁩`;
}

/** The string to give fontkit so that a single-direction visual run is drawn exactly as written. */
function forFontkit(visualRun) {
  return fontkitReverses(visualRun) ? [...visualRun].reverse().join('') : visualRun;
}

/**
 * Split a visual-order line into runs that each contain letters of one direction only.
 * Spaces, digits and punctuation stay with the run they are in.
 */
function splitRuns(visualLine) {
  const runs = [];
  let current = '';
  let currentDir = null; // 'R', 'L' or null (no letters yet)
  for (const ch of visualLine) {
    const dir = RTL_LETTER.test(ch) ? 'R' : ANY_LETTER.test(ch) ? 'L' : null;
    if (dir && currentDir && dir !== currentDir) {
      runs.push(current);
      current = '';
    }
    if (dir) currentDir = dir;
    current += ch;
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * Break text into lines that fit `width`, at spaces (and explicit newlines).
 * A single word wider than the line is split by characters.
 * @param {(s: string) => number} measure  width of a string in the current font and size
 */
function wrapLines(text, width, measure) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.split(/ +/).filter((w) => w !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      // Very long word (e.g. a file name): split it.
      let part = '';
      for (const ch of word) {
        if (part && measure(part + ch) > width) {
          lines.push(part);
          part = '';
        }
        part += ch;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draw a paragraph at (x, y) inside `width`, wrapping and applying bidi.
 * The caller sets font, size and colour first. Returns the y below the last line.
 * @param {{ dir?: 'rtl'|'ltr'|'auto', align?: 'left'|'right'|'center' }} opts
 */
function drawParagraph(doc, text, x, y, width, opts = {}) {
  const dir = opts.dir || 'rtl';
  const align = opts.align || (dir === 'rtl' ? 'right' : 'left');
  // `features` makes pdfkit lay out each string in one piece instead of word by word.
  const textOpts = { lineBreak: false, features: [] };
  const lineHeight = doc.currentLineHeight(true);
  const lines = wrapLines(text, width, (s) => doc.widthOfString(s, textOpts));
  let cursor = y;
  for (const logical of lines) {
    const visual = visualOrder(logical, dir);
    const w = doc.widthOfString(visual, textOpts);
    let lx = x;
    if (align === 'right') lx = x + width - w;
    else if (align === 'center') lx = x + (width - w) / 2;
    for (const run of splitRuns(visual)) {
      doc.text(forFontkit(run), lx, cursor, textOpts);
      lx += doc.widthOfString(run, textOpts);
    }
    cursor += lineHeight;
  }
  return cursor;
}

module.exports = { HEBREW, ltr, stripBidiControls, visualOrder, forFontkit, fontkitReverses, splitRuns, wrapLines, drawParagraph };
