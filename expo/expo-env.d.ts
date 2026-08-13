/// <reference types="expo/types" />

import type React from 'react';

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
  }
}

export {};
