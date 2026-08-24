import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dir, '../app/(tabs)/profile.tsx'), 'utf8');

/**
 * JSX keeps whitespace that sits BETWEEN two sibling tags on the SAME line as a
 * raw string child of the parent element. Inside a plain <View> that string child
 * throws "Text strings must be rendered within a <Text> component" at mount time,
 * which unmounts the whole Profile route tree and produces the certified-black-screen
 * regression (GH PR #305). This gate fails on any such same-line sibling pair.
 */
const SAME_LINE_SIBLINGS = [
  /<\/[A-Za-z][^>]*>[ \t]+<[A-Za-z]/,
  /<[A-Za-z][^>]*\/>[ \t]+<[A-Za-z]/,
  /<[A-Za-z][^>]*>[ \t]+<[A-Za-z]/,
];

describe('Profile black-screen regression — no raw string children in Profile JSX', () => {
  it('never places two sibling JSX tags with whitespace between them on one line', () => {
    const offending = source.split('\n').flatMap((line, index) => {
      const lineNo = index + 1;
      return SAME_LINE_SIBLINGS.filter((rx) => rx.test(line)).map((rx) => {
        const match = line.match(rx);
        return `line ${lineNo}: ${match ? match[0] : ''}`;
      });
    });
    expect(offending).toEqual([]);
  });

  it('keeps the render-safe root, title and full failsafe markers', () => {
    expect(source).toContain('testID="profile-screen-root"');
    expect(source).toContain('testID="profile-root"');
    expect(source).toContain('testID="profile-title"');
    expect(source).toContain('IVX_PROFILE_FULL_FAILSAFE_MARKER');
  });
});
