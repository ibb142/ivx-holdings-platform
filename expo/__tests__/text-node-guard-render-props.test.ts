/**
 * Regression tests for the home-screen black screen.
 *
 * The text-node guard sanitizes stray string children so react-native-web never
 * logs "Unexpected text node". It used to run React.Children.map over EVERY
 * non-Text component's children, which destroyed render-prop tuples:
 *
 *   expo-image's <AnimationManager> receives
 *     children = [animationKey: string, renderFunction: Function]
 *   and later calls children[1](...).
 *
 * React.Children.map wrapped the string in <Text> and DROPPED the function
 * (functions are not valid React children, so the map callback is never invoked
 * for them). The tuple came back as [<Text>, undefined] and expo-image threw
 *   "TypeError: renderFunction[1] is not a function"
 * for every image on the home feed, blacking out the whole screen.
 */
import { describe, expect, test } from 'bun:test';
import React from 'react';
import {
  __sanitizeChildrenForTest,
  containsFunctionChild,
  shouldSanitizeType,
} from '../lib/text-node-guard';

describe('text-node-guard render-prop safety', () => {
  test('detects the expo-image [key, renderFunction] tuple', () => {
    const tuple = ['image-key-1', () => () => null];

    expect(containsFunctionChild(tuple)).toBe(true);
  });

  test('leaves the expo-image tuple completely untouched', () => {
    const renderFunction = () => () => null;
    const tuple = ['image-key-1', renderFunction];

    const result = __sanitizeChildrenForTest(tuple) as unknown[];

    // Same reference: no React.Children.map pass happened at all.
    expect(result).toBe(tuple);
    expect(result[0]).toBe('image-key-1');
    expect(typeof result[1]).toBe('function');
    expect(result[1]).toBe(renderFunction);
  });

  test('the exact expo-image access pattern still works after sanitizing', () => {
    const tuple: [string, () => string] = ['key-a', () => 'rendered'];
    const sanitized = __sanitizeChildrenForTest(tuple) as typeof tuple;

    // This is what AnimationManager.wrapNodeWithCallbacks does.
    expect(sanitized[0] === 'key-a').toBe(true);
    expect(sanitized[1]()).toBe('rendered');
  });

  test('a bare function child is preserved', () => {
    const fn = () => null;

    expect(containsFunctionChild(fn)).toBe(true);
    expect(__sanitizeChildrenForTest(fn)).toBe(fn);
  });

  test('still wraps genuine stray text children', () => {
    const result = __sanitizeChildrenForTest('stray text') as React.ReactElement[];
    const first = Array.isArray(result) ? result[0] : result;

    expect(first).toBeTruthy();
    expect(typeof first).toBe('object');
  });

  test('still drops whitespace-only children', () => {
    const result = __sanitizeChildrenForTest('   ');
    const first = Array.isArray(result) ? result[0] : result;

    expect(first == null).toBe(true);
  });

  test('non-function children arrays are still sanitized', () => {
    expect(containsFunctionChild(['plain text', 42])).toBe(false);
  });

  test('AnimationManager-like components are still sanitize candidates', () => {
    // The guard must not have been disabled wholesale — type-level sanitizing
    // stays on; only function-carrying children are skipped.
    const Dummy = function AnimationManager() {
      return null;
    };

    expect(shouldSanitizeType(Dummy)).toBe(true);
  });
});
