import { useEffect, useRef, useCallback, useMemo } from 'react';
import { InteractionManager } from 'react-native';
import { analytics } from './analytics';
import { supabase } from './supabase';
import { usePathname } from 'expo-router';
import type { EventCategory } from './analytics';
import createContextHook from '@nkzw/create-context-hook';
import { usePresenceBroadcast, presenceManager } from './realtime-presence';

export interface AnalyticsHook {
  trackScreen: (screenName: string, params?: Record<string, unknown>) => void;
  trackAction: (action: string, details?: Record<string, unknown>) => void;
  trackTransaction: (type: 'buy' | 'sell' | 'deposit' | 'withdraw', amount: number, currency: string, details?: Record<string, unknown>) => void;
  trackConversion: (conversionType: string, value?: number, details?: Record<string, unknown>) => void;
  trackError: (errorName: string, errorMessage: string, stack?: string, context?: Record<string, unknown>) => void;
  track: (name: string, category?: EventCategory, properties?: Record<string, unknown>) => void;
}

const analyticsFallback: AnalyticsHook = {
  trackScreen: () => {},
  trackAction: () => {},
  trackTransaction: () => {},
  trackConversion: () => {},
  trackError: () => {},
  track: () => {},
};

export const [AnalyticsProvider, useAnalytics] = createContextHook<AnalyticsHook>(() => {
  const pathname = usePathname();
  const lastPathnameRef = useRef<string>('');

  usePresenceBroadcast({
    sessionId: analytics.getSessionId(),
    source: 'app',
    page: pathname ?? 'App',
  });

  useEffect(() => {
    if (pathname) {
      presenceManager.updatePage(pathname);
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let booted = false;

    const bootstrapAnalytics = () => {
      if (cancelled || booted) return;
      booted = true;
      analytics.revive();
      void analytics.initialize();
      analytics.track('app_open', 'navigation', { timestamp: Date.now() });
    };

    const interactionTask = InteractionManager.runAfterInteractions(bootstrapAnalytics);
    const fallbackTimeout = setTimeout(bootstrapAnalytics, 900);

    return () => {
      cancelled = true;
      interactionTask.cancel();
      clearTimeout(fallbackTimeout);
      analytics.track('session_end', 'navigation', {
        sessionDuration: analytics.getSessionDuration(),
        timestamp: Date.now(),
      });
      void analytics.flush();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let lastBoundUserId: string | null = null;

    const bindIdentity = async (userId?: string | null) => {
      if (cancelled || !userId || userId === lastBoundUserId) return;
      const sessionId = analytics.getSessionId();
      if (!sessionId) return;

      const { error } = await supabase.rpc('ivx_analytics_identify', { p_session_id: sessionId });
      if (cancelled) return;
      if (error) {
        console.log('[Analytics] Identity stitch failed:', error.message);
        return;
      }

      lastBoundUserId = userId;
      analytics.track('analytics_identity_bound', 'engagement', {
        userId,
        session_id: sessionId,
      });
      await analytics.forceSyncNow();
    };

    void supabase.auth.getSession()
      .then(({ data }) => bindIdentity(data.session?.user?.id))
      .catch((error) => console.log('[Analytics] Initial identity lookup failed:', (error as Error)?.message ?? 'unknown'));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.id) {
        lastBoundUserId = null;
        return;
      }
      void bindIdentity(session.user.id);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (pathname && pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = pathname;
      const screenName = pathname === '/' ? 'home' : pathname.replace(/^\//, '').replace(/\//g, '_');
      analytics.trackScreenView(screenName, { path: pathname });
    }
  }, [pathname]);

  const trackScreen = useCallback((screenName: string, params?: Record<string, unknown>) => analytics.trackScreenView(screenName, params), []);
  const trackAction = useCallback((action: string, details?: Record<string, unknown>) => analytics.trackUserAction(action, details), []);
  const trackTransaction = useCallback((type: 'buy' | 'sell' | 'deposit' | 'withdraw', amount: number, currency: string, details?: Record<string, unknown>) => analytics.trackTransaction(type, amount, currency, details), []);
  const trackConversion = useCallback((conversionType: string, value?: number, details?: Record<string, unknown>) => analytics.trackConversion(conversionType, value, details), []);
  const trackError = useCallback((errorName: string, errorMessage: string, stack?: string, context?: Record<string, unknown>) => analytics.trackError(errorName, errorMessage, stack, context), []);
  const track = useCallback((name: string, category?: EventCategory, properties?: Record<string, unknown>) => analytics.track(name, category, properties), []);

  return useMemo<AnalyticsHook>(() => ({
    trackScreen,
    trackAction,
    trackTransaction,
    trackConversion,
    trackError,
    track,
  }), [trackScreen, trackAction, trackTransaction, trackConversion, trackError, track]);
}, analyticsFallback);

export default AnalyticsProvider;
