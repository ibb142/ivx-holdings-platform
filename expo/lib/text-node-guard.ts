import React from 'react';
import { Platform, Text, TextInput } from 'react-native';

/**
 * Global guard against the React Native (Web) runtime error:
 *   "Unexpected text node: <x>. A text node cannot be a child of a <View>."
 *
 * WHERE IT COMES FROM
 * react-native-web's View logs this via `console.error` (NOT a throw) from
 * inside its own render:
 *   node_modules/react-native-web/dist/exports/View/index.js:55-57
 *     React.Children.toArray(props.children).forEach(item => {
 *       if (typeof item === 'string') { console.error("Unexpected text node: ...") }
 *     });
 * Because it is a `console.error`, the app does not crash — the message simply
 * persists as a red error overlay until the offending render path is removed.
 *
 * ROOT CAUSE OF THE PERSISTENT ERROR
 * A raw string/number reaches the INNER react-native-web `View`. That can happen
 * directly (`<View>{str}</View>`) OR — much more commonly and invisibly —
 * THROUGH A WRAPPER that renders a View internally:
 *   - `Animated.View`  (react-native-web wraps View in a forwardRef object with
 *     NO `displayName`)
 *   - `LinearGradient`, `BlurView`
 *   - any custom component whose body is `<View>{children}</View>`
 * An allowlist of "View-like" hosts can never cover all of these, so strings
 * routed through a wrapper were never sanitized and the error kept firing.
 *
 * THE FIX (inverse allowlist)
 * A raw string/number is ONLY ever valid as a direct child of a TEXT host
 * (`Text` / `TextInput`). For EVERY other element type we:
 *   1. Drop whitespace-only string children (harmless, still triggers the log).
 *   2. Wrap any non-whitespace string/number child in <Text> before it can reach
 *      a View. Wrapping is safe inside any non-text component: nested <Text> and
 *      View-with-Text children both render correctly on web and native.
 *   3. Log the offending text + a captured stack trace ONCE per unique site so
 *      the true source file/component is still identifiable.
 *
 * babel-preset-expo uses the AUTOMATIC JSX runtime, so compiled JSX calls
 * `jsx`/`jsxs` (react/jsx-runtime) and `jsxDEV` (react/jsx-dev-runtime) — NOT
 * React.createElement. Children arrive in `props.children`. We patch all of
 * those entry points (plus createElement for any classic-runtime code).
 *
 * Installed once, before the app tree renders, from app/_layout.tsx.
 */

let installed = false;

const reportedSites = new Set<string>();

/** Element types that legitimately accept raw string/number children. */
function isTextAcceptingType(type: unknown): boolean {
  if (type === Text || type === TextInput) {
    return true;
  }
  if (type == null) {
    return false;
  }
  // Unwrap memo()/forwardRef() containers to inspect the inner component name.
  const candidates: unknown[] = [
    type,
    (type as { type?: unknown }).type,
    (type as { render?: unknown }).render,
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const named = candidate as { displayName?: string; name?: string };
    const label = named.displayName ?? named.name;
    if (typeof label === 'string') {
      if (
        label === 'Text' ||
        label === 'TextInput' ||
        label === 'VirtualText' ||
        label === 'RCTText' ||
        label.endsWith('(Text)') ||
        label.endsWith('(TextInput)')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether stray string/number children of this element type must be sanitized.
 * Everything EXCEPT text hosts, string DOM hosts, and fragments is sanitized —
 * this is what closes the wrapper gap (Animated.View / LinearGradient / custom).
 */
export function shouldSanitizeType(type: unknown): boolean {
  if (type == null) {
    return false;
  }
  // Intrinsic host strings ('div', 'span', ...). RN app code never targets these
  // directly; react-native-web's own internal createElement passes object
  // children, so leaving them alone avoids interfering with the host renderer.
  if (typeof type === 'string') {
    return false;
  }
  // React.Fragment / Suspense / other symbol-typed builtins: strings inside a
  // fragment are not direct View children and render fine — don't touch them.
  if (typeof type === 'symbol') {
    return false;
  }
  if ((type as { $$typeof?: symbol }).$$typeof === undefined && typeof type !== 'function') {
    // Plain objects that aren't memo/forwardRef elements — be conservative.
    if (!(type as { type?: unknown }).type && !(type as { render?: unknown }).render) {
      return false;
    }
  }
  return !isTextAcceptingType(type);
}

/**
 * Whether `children` carries a function anywhere at the top level.
 *
 * Some libraries pass children as a render-prop tuple rather than as renderable
 * nodes. expo-image's `AnimationManager` is the canonical case: it receives
 * `[animationKey: string, renderFunction: (cb) => (className, style) => Element]`
 * and later reads `children[1]` expecting a function.
 *
 * `React.Children.map` cannot round-trip that shape: it wraps the string element
 * in <Text> AND silently DROPS the function element (a function is not a valid
 * React child, so React never invokes the map callback for it). The tuple comes
 * back as `[<Text>, undefined]`, and the consumer throws
 * "renderFunction[1] is not a function", taking the whole screen down.
 *
 * A raw string inside such a tuple is never rendered as a text node, so there is
 * nothing to guard against here — skipping these children is always correct.
 */
export function containsFunctionChild(children: React.ReactNode): boolean {
  if (typeof children === 'function') {
    return true;
  }
  if (Array.isArray(children)) {
    return children.some(
      (child) =>
        typeof child === 'function' ||
        (Array.isArray(child) && child.some((inner) => typeof inner === 'function')),
    );
  }
  return false;
}

function reportStrayChild(text: string): void {
  const stack = new Error('text-node-guard').stack ?? '';
  const key = `${text.slice(0, 24)}::${stack.split('\n').slice(3, 5).join('|')}`;
  if (reportedSites.has(key)) {
    return;
  }
  reportedSites.add(key);
  console.warn(
    `[text-node-guard] Wrapped a stray text node ${JSON.stringify(text.slice(0, 60))} that would have triggered "Unexpected text node" in a <View>.`,
    '\nSource trace:\n' + stack.split('\n').slice(3, 9).join('\n'),
  );
}

/** Returns sanitized children, or the original reference if nothing changed. */
function sanitizeChildren(children: React.ReactNode): { value: React.ReactNode; mutated: boolean } {
  // Never touch render-prop tuples — React.Children.map would destroy them.
  if (containsFunctionChild(children)) {
    return { value: children, mutated: false };
  }

  let mutated = false;
  const mapped = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      if (child.trim().length === 0) {
        mutated = true;
        return null;
      }
      mutated = true;
      reportStrayChild(child);
      return React.createElement(Text, null, child);
    }
    if (typeof child === 'number' && Number.isFinite(child)) {
      mutated = true;
      reportStrayChild(String(child));
      return React.createElement(Text, null, String(child));
    }
    return child;
  });
  return { value: mutated ? mapped : children, mutated };
}

/** Test-only: exercise the sanitizer directly without the JSX runtime. */
export function __sanitizeChildrenForTest(children: React.ReactNode): React.ReactNode {
  return sanitizeChildren(children).value;
}

type JsxFn = (type: unknown, props: Record<string, unknown> | null, ...rest: unknown[]) => unknown;

function wrapJsx(original: JsxFn): JsxFn {
  return function patchedJsx(type, props, ...rest) {
    if (props && 'children' in props && shouldSanitizeType(type)) {
      const { value, mutated } = sanitizeChildren(props.children as React.ReactNode);
      if (mutated) {
        return original(type, { ...props, children: value }, ...rest);
      }
    }
    return original(type, props, ...rest);
  };
}

function patchModule(mod: Record<string, unknown> | null | undefined, keys: string[]): boolean {
  if (!mod) {
    return false;
  }
  let patchedAny = false;
  for (const key of keys) {
    const fn = mod[key];
    if (typeof fn === 'function') {
      try {
        mod[key] = wrapJsx(fn as JsxFn);
        patchedAny = true;
      } catch {
        // Some bundlers freeze module exports; ignore and rely on other paths.
      }
    }
  }
  return patchedAny;
}

/** Runtime self-test: prove the patch actually intercepts before render. */
function runSelfTest(): void {
  try {
    // Static require — Metro requires a string literal argument.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const runtime = require('react/jsx-dev-runtime') as { jsxDEV?: JsxFn };
    const jsxDEV = runtime?.jsxDEV;
    if (typeof jsxDEV !== 'function') {
      return;
    }
    // A non-text host (use a dummy component) with a raw string child.
    const Dummy = function Dummy() {
      return null;
    };
    const element = jsxDEV(Dummy, { children: 'self-test' }) as {
      props?: { children?: unknown };
    };
    const child = element?.props?.children;
    const ok = child != null && typeof child === 'object' && !Array.isArray(child);
    if (ok) {
      console.log('[text-node-guard] self-test PASS — stray string children are wrapped before reaching <View>.');
    } else {
      console.warn('[text-node-guard] self-test did not wrap the probe child; interception may be inactive.');
    }
  } catch {
    // Self-test is best-effort; never block app start.
  }
}

/**
 * Install the global text-node guard. Safe to call multiple times.
 *
 * WEB ONLY — deliberately a no-op on iOS/Android.
 *
 * The only thing this guard suppresses is react-native-web's
 * "Unexpected text node: ... A text node cannot be a child of a <View>"
 * console.error, which is emitted from
 * `react-native-web/dist/exports/View/index.js`. That module does not exist in
 * a native build, so on iOS/Android the guard has ZERO benefit.
 *
 * What it costs on native is severe: it rewrites `react/jsx-runtime`,
 * `react/jsx-dev-runtime` and `React.createElement` for EVERY element the app
 * renders, and routes their children through `React.Children.map`. That call
 * cannot round-trip non-node children (functions are silently dropped, variadic
 * children get collapsed into an array), so any component using a render-prop
 * or tuple children shape gets corrupted and throws mid-render — which takes
 * the whole screen down to black.
 *
 * Trading a cosmetic web-only console warning for an app-wide crash risk on the
 * shipped mobile app is never correct, so native simply does not install it.
 */
export function installTextNodeGuard(): void {
  if (installed) {
    return;
  }
  if (Platform.OS !== 'web') {
    installed = true;
    return;
  }
  installed = true;

  // Automatic runtime (production + standard builds).
  // NOTE: Metro can only bundle require() with a STATIC string literal — a
  // dynamic require(variable) is an "Invalid call" build error that breaks the
  // entire bundle, so each module is required by literal here.
  let jsxRuntime: Record<string, unknown> | null = null;
  let jsxDevRuntime: Record<string, unknown> | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jsxRuntime = require('react/jsx-runtime') as Record<string, unknown>;
  } catch {
    jsxRuntime = null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jsxDevRuntime = require('react/jsx-dev-runtime') as Record<string, unknown>;
  } catch {
    jsxDevRuntime = null;
  }
  patchModule(jsxRuntime, ['jsx', 'jsxs']);
  // Automatic runtime (development — what the Rork preview uses).
  patchModule(jsxDevRuntime, ['jsxDEV']);

  // Classic runtime fallback (any code still calling React.createElement).
  const originalCreateElement = React.createElement.bind(React) as typeof React.createElement;
  (React as unknown as { createElement: typeof React.createElement }).createElement = function patchedCreateElement(
    type: Parameters<typeof React.createElement>[0],
    props?: Parameters<typeof React.createElement>[1],
    ...children: React.ReactNode[]
  ) {
    if (children.length > 0 && shouldSanitizeType(type)) {
      const { value, mutated } = sanitizeChildren(children.length === 1 ? children[0] : children);
      // Only collapse children into a single (array) argument when we actually
      // wrapped a stray text node. Re-passing untouched variadic children as a
      // single array would make React treat previously-static siblings as a
      // dynamic list and emit a spurious "unique key prop" warning (e.g. SVG
      // icon <Path> children from lucide-react-native). When mutated, the value
      // comes from React.Children.map, which assigns stable keys, so it is safe.
      if (mutated) {
        return originalCreateElement(type, props, value);
      }
    }
    return originalCreateElement(type, props, ...children);
  } as typeof React.createElement;

  runSelfTest();
}
