import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  // subscribe 必须稳定：每次渲染传入新函数会让 React 每次渲染都退订再重新订阅 matchMedia
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => !useMediaQuery('(min-width: 768px)');
