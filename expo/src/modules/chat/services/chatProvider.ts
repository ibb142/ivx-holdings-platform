import type { ChatProvider } from '../types/chat';
import { supabaseChatProvider } from './supabaseChatProvider';

// Direct room routes can render before any app-bootstrap effect runs.
// Default to the real authenticated storage adapter; explicit overrides remain.
let activeProvider: ChatProvider = supabaseChatProvider;

export const setChatProvider = (provider: ChatProvider): void => {
  console.log('[ChatProvider] Provider configured');
  activeProvider = provider;
};

export const getChatProvider = (): ChatProvider => {
  if (!activeProvider) {
    throw new Error('Chat provider not configured. Configure it during app bootstrap before using the chat module.');
  }

  return activeProvider;
};
