/**
 * AccessibilityAnnouncer — Screen reader state announcement component.
 *
 * Wrap a screen with this to automatically announce loading, error,
 * and success states to VoiceOver/TalkBack users.
 *
 * Usage:
 * ```tsx
 * <AccessibilityAnnouncer
 *   isLoading={isLoading}
 *   isError={isError}
 *   isEmpty={isEmpty}
 *   message="Projects loaded"
 * />
 * ```
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export interface AccessibilityAnnouncerProps {
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  isSuccess?: boolean;
  message?: string;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
}

export function AccessibilityAnnouncer({
  isLoading = false,
  isError = false,
  isEmpty = false,
  isSuccess = false,
  message,
  loadingMessage = 'Loading content',
  errorMessage = 'Error loading content',
  emptyMessage = 'No content available',
}: AccessibilityAnnouncerProps) {
  const lastAnnounced = useRef<string>('');

  useEffect(() => {
    let announcement = '';
    if (isLoading) announcement = loadingMessage;
    else if (isError) announcement = errorMessage;
    else if (isEmpty) announcement = emptyMessage;
    else if (isSuccess && message) announcement = message;

    if (announcement && announcement !== lastAnnounced.current) {
      lastAnnounced.current = announcement;
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [
    isLoading,
    isError,
    isEmpty,
    isSuccess,
    message,
    loadingMessage,
    errorMessage,
    emptyMessage,
  ]);

  // This component renders nothing — it only announces
  return null;
}

export default AccessibilityAnnouncer;
