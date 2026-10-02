// Google Analytics 4, Mudalali-style: live hostname only, after the page has fully loaded,
// never when offline or when the browser sends Do Not Track or Global Privacy Control.
// Events carry nothing derived from a file: no names, sizes, page counts or text.
import { config } from '../pdfmango.config';

type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export type AnalyticsEvent =
  | { name: 'file_added'; params: { kind: 'pdf' | 'image' | 'docx' | 'text' } }
  | { name: 'export'; params: { level: string } }
  | { name: 'error'; params: { code: string } };

let enabled = false;

export type AnalyticsEnv = {
  hostname: string;
  online: boolean;
  doNotTrack: string | null | undefined;
  globalPrivacyControl: boolean | undefined;
  measurementId: string;
};

/** Whether analytics may run at all in this environment. */
export function analyticsAllowed(env: AnalyticsEnv): boolean {
  return (
    /^G-[A-Z0-9]+$/.test(env.measurementId) &&
    env.measurementId !== 'G-XXXXXXXXXX' &&
    env.hostname === config.analytics.liveHostname &&
    env.online &&
    env.doNotTrack !== '1' &&
    env.globalPrivacyControl !== true
  );
}

function currentEnv(): AnalyticsEnv {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    hostname: location.hostname,
    online: navigator.onLine,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: nav.globalPrivacyControl,
    measurementId: config.analytics.measurementId,
  };
}

/** Call once at startup; loads gtag only after the window `load` event, when allowed. */
export function initAnalytics() {
  const start = () => {
    if (!analyticsAllowed(currentEnv())) return;
    const w = window as AnalyticsWindow;
    w.dataLayer = w.dataLayer || [];
    // gtag must push the `arguments` object itself, not an array copy.
    w.gtag = function gtag() {
      w.dataLayer!.push(arguments);
    };
    w.gtag('js', new Date());
    w.gtag('config', config.analytics.measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.analytics.measurementId)}`;
    document.head.append(s);
    enabled = true;
  };
  if (document.readyState === 'complete') setTimeout(start, 0);
  else window.addEventListener('load', () => setTimeout(start, 0), { once: true });
}

export function track(e: AnalyticsEvent) {
  if (!enabled || !navigator.onLine) return;
  (window as AnalyticsWindow).gtag?.('event', e.name, e.params);
}
