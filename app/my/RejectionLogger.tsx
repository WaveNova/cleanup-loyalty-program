'use client';

import { useEffect } from 'react';

export default function RejectionLogger() {
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      console.error('[unhandled rejection]', e.reason);
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return null;
}
