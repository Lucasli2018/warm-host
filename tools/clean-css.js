#!/usr/bin/env node
/*
 * clean-css.js — Convert public/css/style.css to pure UTF-8 (no BOM),
 * replacing GBK-corrupted comment blocks with readable placeholders.
 *
 * Strategy:
 * 1. Read as raw bytes. Strip UTF-8 BOM if present.
 * 2. Walk bytes to identify every SLASH-STAR ... STAR-SLASH comment span.
 * 3. For each comment span, if the raw bytes contain U+FFFD in UTF-8
 *    (0xEF 0xBF 0xBD — the literal replacement character that got
 *    written to disk) OR any stray high-byte sequences, replace the
 *    entire comment block with a placeholder marker string.
 * 4. Non-comment bytes are preserved verbatim.
 * 5. Safety check: decode the ORIGINAL and the CLEANED buffers (both
 *    with TextDecoder fatal:false), strip comment spans from each string,
 *    and compare byte-for-byte (via UTF-8 re-encode). Must match
 *    exactly or abort without writing.
 * 6. Write back as UTF-8 (no BOM).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = 'F:\\LLM\\warm-host\\public\\css\\style.css';

function readBytes(p) {
  return fs.readFileSync(p);
}

function hasFFFD(buf, start, end) {
  // Scan the byte range [start, end) for EF BF BD (the literal UTF-8
  // replacement character U+FFFD that got written to disk) or for any
  // high byte that is NOT part of a well-formed 2- or 3-byte UTF-8
  // sequence (i.e. stray GBK leftovers).
  for (let i = start; i < end; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    // 1) FFFD sequence
    if (i + 2 < end && b === 0xEF && buf[i + 1] === 0xBF && buf[i + 2] === 0xBD) {
      return true;
    }
    // 2) valid 2-byte UTF-8 (lead C2-DF + continuation 80-BF)
    if (b >= 0xC2 && b <= 0xDF && i + 1 < end && (buf[i + 1] & 0xC0) === 0x80) {
      i++;
      continue;
    }
    // 3) valid 3-byte UTF-8 (lead E0-EF + two continuation bytes)
    if (b >= 0xE0 && b <= 0xEF && i + 2 < end &&
        (buf[i + 1] & 0xC0) === 0x80 && (buf[i + 2] & 0xC0) === 0x80) {
      i += 2;
      continue;
    }
    // 4) stray high byte (GBK leftover or mis-encoded)
    return true;
  }
  return false;
}

function isBadComment(buf, start, end) {
  // Bad if it contains EF BF BD OR a suspicious high byte that isn't
  // part of a well-formed UTF-8 sequence.
  return hasFFFD(buf, start, end);
}

function main() {
  const original = readBytes(FILE);
  let buf = original;

  // Strip UTF-8 BOM if present
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    buf = buf.slice(3);
    console.log('Stripped UTF-8 BOM');
  }

  // Walk through the file, building a list of comment spans
  const comments = []; // [{start, end}]
  let i = 0;
  const n = buf.length;
  while (i < n - 1) {
    if (buf[i] === 0x2F && buf[i + 1] === 0x2A) {
      const start = i;
      // find matching */
      let j = i + 2;
      while (j < n - 1) {
        if (buf[j] === 0x2A && buf[j + 1] === 0x2F) {
          break;
        }
        j++;
      }
      const end = j + 2; // end is exclusive, past the */
      comments.push({ start, end });
      i = end;
    } else {
      i++;
    }
  }

  console.log(`Found ${comments.length} comment blocks`);

  // Find bad comments (containing FFFD or stray bytes)
  const bad = comments.filter(c => isBadComment(buf, c.start, c.end));
  console.log(`Bad comments (need replacement): ${bad.length}`);

  // Build new buffer
  const parts = [];
  let prev = 0;
  for (const c of comments) {
    if (c.start > prev) {
      parts.push(buf.slice(prev, c.start));
    }
    if (isBadComment(buf, c.start, c.end)) {
      parts.push(Buffer.from('/* (legacy comment removed) */', 'utf8'));
    } else {
      parts.push(buf.slice(c.start, c.end));
    }
    prev = c.end;
  }
  if (prev < n) {
    parts.push(buf.slice(prev, n));
  }
  const cleaned = Buffer.concat(parts);

  console.log(`Original size: ${original.length} bytes`);
  console.log(`Cleaned size: ${cleaned.length} bytes`);

  // Safety check: strip comments from both decoded strings, compare
  const decOrig = new TextDecoder('utf-8', {fatal: false}).decode(original);
  const decClean = new TextDecoder('utf-8', {fatal: false}).decode(cleaned);
  const strippedOrig = decOrig.replace(/\/\*[\s\S]*?\*\//g, '');
  const strippedClean = decClean.replace(/\/\*[\s\S]*?\*\//g, '');

  if (strippedOrig !== strippedClean) {
    // Find the first diff
    let idx = 0;
    while (idx < Math.min(strippedOrig.length, strippedClean.length)) {
      if (strippedOrig[idx] !== strippedClean[idx]) break;
      idx++;
    }
    const ctxOrig = strippedOrig.slice(Math.max(0, idx-40), idx+80);
    const ctxClean = strippedClean.slice(Math.max(0, idx-40), idx+80);
    console.error('SAFETY CHECK FAILED at char index', idx);
    console.error('Original:', JSON.stringify(ctxOrig));
    console.error('Cleaned: ', JSON.stringify(ctxClean));
    throw new Error('Aborting: non-comment content would change');
  }

  // Also verify no FFFD remains
  let remainingFffd = 0;
  for (let i = 0; i + 2 < cleaned.length; i++) {
    if (cleaned[i] === 0xEF && cleaned[i + 1] === 0xBF && cleaned[i + 2] === 0xBD) {
      remainingFffd++;
      i += 2;
    }
  }
  console.log(`Remaining U+FFFD in output: ${remainingFffd}`);
  if (remainingFffd > 0) {
    throw new Error('Aborting: FFFD characters remain in cleaned file');
  }

  // Final strict UTF-8 validity check
  try {
    new TextDecoder('utf-8', {fatal: true}).decode(cleaned);
    console.log('Output is valid strict UTF-8');
  } catch (e) {
    throw new Error('Output is not valid strict UTF-8: ' + e.message);
  }

  fs.writeFileSync(FILE, cleaned);
  console.log('Written. Final size:', fs.statSync(FILE).size, 'bytes');
}

try {
  main();
} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
}
