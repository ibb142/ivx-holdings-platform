import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Samsung Internet / Android Chrome keyboard detection via the VisualViewport API.
 *
 * On Samsung Browser, `window.innerHeight` shrinks when the soft keyboard opens,
 * but the resize event may fire inconsistently. The VisualViewport API is the
 * reliable signal: when `visualViewport.height` drops below `window.innerHeight`,
 * the keyboard is visible. The difference is the keyboard height.
 *
 * Returns:
 * - keyboardHeight: px of the soft keyboard (0 when closed)
 * - isKeyboardVisible: whether the keyboard is open
 * - viewportHeight: current visualViewport.height
 */
export function useWebKeyboard() {
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState<boolean>(false);
  const [viewportHeight, setViewportHeight] = useState<number>(0);
  const prevHeightRef = useRef<number>(0);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const vv = window.visualViewport;
    if (!vv) {
      return;
    }

    const computeKeyboard = () => {
      const vh = vv.height;
      const wh = window.innerHeight;
      setViewportHeight(vh);

      // keyboard height = how much the visual viewport shrank relative to the window
      const kbHeight = Math.max(wh - vh - vv.offsetTop, 0);
      const visible = kbHeight > 80; // threshold to avoid false positives from URL bar

      if (visible !== prevHeightRef.current > 0 || Math.abs(kbHeight - prevHeightRef.current) > 10) {
        setKeyboardHeight(kbHeight);
        setIsKeyboardVisible(visible);
        prevHeightRef.current = kbHeight;
      }
    };

    computeKeyboard();
    vv.addEventListener('resize', computeKeyboard);
    vv.addEventListener('scroll', computeKeyboard);

    return () => {
      vv.removeEventListener('resize', computeKeyboard);
      vv.removeEventListener('scroll', computeKeyboard);
    };
  }, []);

  return { keyboardHeight, isKeyboardVisible, viewportHeight };
}

/**
 * Injects global CSS needed for Samsung Internet / Android Chrome keyboard support.
 *
 * - `touch-action: manipulation` on inputs prevents double-tap zoom delay
 * - `user-select: text` ensures inputs are selectable
 * - `100dvh` / `100svh` handle Samsung's dynamic toolbar
 * - `env(safe-area-inset-bottom)` respects home indicator
 *
 * Called once at app root on web only.
 */
export function injectWebKeyboardCSS() {
  if (Platform.OS !== 'web') {
    return;
  }

  if (typeof document === 'undefined') {
    return;
  }

  const styleId = 'ivx-web-keyboard-fix';
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* IVX dark theme: override react-native-web's default black text color.
       react-native-web sets color: rgb(0,0,0) on all Text elements by default.
       On a black background, this makes text invisible. Override to inherit
       so the root View's color (#FFFFFF) cascades down. */
    #root {
      color: #FFFFFF;
      background-color: #000000;
    }
    .css-146c3p1 {
      color: inherit;
    }

    /* IVX Samsung keyboard fix — ensure inputs are focusable and editable */
    textarea, input[type="text"], input[type="email"], input[type="password"],
    input[type="search"], input[type="tel"], input[type="url"], [contenteditable] {
      -webkit-touch-callout: default !important;
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      user-select: text !important;
      touch-action: manipulation !important;
      -webkit-tap-highlight-color: transparent;
      pointer-events: auto !important;
    }

    /* Prevent GestureHandlerRootView from blocking input taps on Samsung */
    [data-ghroot], .gesture-handler-root-view {
      touch-action: auto !important;
    }

    /* Use dynamic viewport units for Samsung's address bar resize */
    html, body {
      height: 100%;
    }

    body {
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
    }

    /* Ensure the app root fills the dynamic viewport */
    #root {
      min-height: 100svh;
    }

    /* Prevent fixed-position overlays from trapping keyboard focus */
    [data-ivx-overlay] {
      pointer-events: none;
    }

    [data-ivx-overlay="active"] {
      pointer-events: auto;
    }
  `;

  document.head.appendChild(style);
}

/**
 * Scrolls an element into view above the keyboard on Samsung.
 * Uses visualViewport to calculate the correct offset.
 */
export function scrollInputIntoView(element: HTMLElement | null) {
  if (Platform.OS !== 'web' || !element) {
    return;
  }

  const vv = window.visualViewport;
  if (!vv) {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  // Use rAF to wait for keyboard animation to settle
  requestAnimationFrame(() => {
    const rect = element.getBoundingClientRect();
    const vvBottom = vv.height + vv.offsetTop;

    // If the input is below the visible viewport (hidden by keyboard)
    if (rect.bottom > vvBottom) {
      const scrollAmount = rect.bottom - vvBottom + 20;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }
  });
}
