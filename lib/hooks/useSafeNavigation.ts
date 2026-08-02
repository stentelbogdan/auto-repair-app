"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type NavigationOptions = {
  scroll?: boolean;
};

type LockedNavigationActions = {
  navigate: (url: string, options?: NavigationOptions) => void;
  replace: (url: string, options?: NavigationOptions) => void;
};

type UseSafeNavigationOptions = {
  /**
   * Timp maxim în care navigarea rămâne blocată dacă ruta
   * nu se schimbă sau navigarea eșuează silențios.
   */
  timeoutMs?: number;
};

export function useSafeNavigation(options: UseSafeNavigationOptions = {}) {
  const { timeoutMs = 2500 } = options;

  const router = useRouter();
  const pathname = usePathname();

  const [isNavigating, setIsNavigating] = useState(false);

  /*
   * Ref-ul este sursa sincronă de adevăr.
   *
   * Nu ne bazăm doar pe state, deoarece două clickuri foarte rapide
   * pot apărea înainte ca React să aplice setIsNavigating(true).
   */
  const isNavigatingRef = useRef(false);

  /*
   * Identifică navigarea activă.
   *
   * Este util mai ales pentru operații asincrone: dacă timeout-ul
   * a eliberat deja blocarea, o operație veche nu mai poate porni
   * ulterior o navigare întârziată.
   */
  const activeNavigationIdRef = useRef<number | null>(null);
  const navigationIdCounterRef = useRef(0);

  const timeoutRef = useRef<number | null>(null);

  const mountedRef = useRef(false);
  const previousPathnameRef = useRef(pathname);

  const clearSafetyTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const releaseNavigation = useCallback(
    (navigationId?: number) => {
      /*
       * Dacă primim un ID, eliberăm doar navigarea care este
       * încă activă. Astfel, un timeout vechi nu poate debloca
       * o navigare nouă.
       */
      if (
        navigationId !== undefined &&
        activeNavigationIdRef.current !== navigationId
      ) {
        return;
      }

      clearSafetyTimeout();

      isNavigatingRef.current = false;
      activeNavigationIdRef.current = null;

      if (mountedRef.current) {
        setIsNavigating(false);
      }
    },
    [clearSafetyTimeout],
  );

  const acquireNavigationLock = useCallback((): number | null => {
    if (isNavigatingRef.current) {
      return null;
    }

    navigationIdCounterRef.current += 1;

    const navigationId = navigationIdCounterRef.current;

    isNavigatingRef.current = true;
    activeNavigationIdRef.current = navigationId;

    if (mountedRef.current) {
      setIsNavigating(true);
    }

    clearSafetyTimeout();

    timeoutRef.current = window.setTimeout(() => {
      releaseNavigation(navigationId);
    }, timeoutMs);

    return navigationId;
  }, [clearSafetyTimeout, releaseNavigation, timeoutMs]);

  const performNavigation = useCallback(
    (
      method: "push" | "replace",
      navigationId: number,
      url: string,
      navigationOptions?: NavigationOptions,
    ) => {
      /*
       * O operație asincronă veche poate ajunge aici după timeout.
       * În acel caz nu mai permitem navigarea.
       */
      if (
        !isNavigatingRef.current ||
        activeNavigationIdRef.current !== navigationId
      ) {
        return false;
      }

      if (method === "replace") {
        router.replace(url, navigationOptions);
      } else {
        router.push(url, navigationOptions);
      }

      return true;
    },
    [router],
  );

  const navigate = useCallback(
    (url: string, navigationOptions?: NavigationOptions) => {
      const navigationId = acquireNavigationLock();

      if (navigationId === null) {
        return false;
      }

      return performNavigation("push", navigationId, url, navigationOptions);
    },
    [acquireNavigationLock, performNavigation],
  );

  const replace = useCallback(
    (url: string, navigationOptions?: NavigationOptions) => {
      const navigationId = acquireNavigationLock();

      if (navigationId === null) {
        return false;
      }

      return performNavigation("replace", navigationId, url, navigationOptions);
    },
    [acquireNavigationLock, performNavigation],
  );

  /*
   * Folosit când trebuie executată o verificare asincronă
   * înainte de navigare, de exemplu verificarea rolurilor.
   *
   * Blocarea începe imediat, înainte de request-ul Supabase.
   */
  const runLocked = useCallback(
    async (
      task: (actions: LockedNavigationActions) => void | Promise<void>,
    ) => {
      const navigationId = acquireNavigationLock();

      if (navigationId === null) {
        return false;
      }

      let navigationStarted = false;

      const actions: LockedNavigationActions = {
        navigate: (url, navigationOptions) => {
          if (navigationStarted) {
            return;
          }

          const didNavigate = performNavigation(
            "push",
            navigationId,
            url,
            navigationOptions,
          );

          if (didNavigate) {
            navigationStarted = true;
          }
        },

        replace: (url, navigationOptions) => {
          if (navigationStarted) {
            return;
          }

          const didNavigate = performNavigation(
            "replace",
            navigationId,
            url,
            navigationOptions,
          );

          if (didNavigate) {
            navigationStarted = true;
          }
        },
      };

      try {
        await task(actions);

        /*
         * Dacă verificarea s-a încheiat fără navigare,
         * eliberăm imediat blocarea.
         */
        if (!navigationStarted) {
          releaseNavigation(navigationId);
        }

        return true;
      } catch (error) {
        releaseNavigation(navigationId);
        throw error;
      }
    },
    [acquireNavigationLock, performNavigation, releaseNavigation],
  );

  /*
   * Eliberăm blocarea imediat ce pathname-ul s-a schimbat.
   */
  useEffect(() => {
    if (previousPathnameRef.current === pathname) {
      return;
    }

    previousPathnameRef.current = pathname;

    if (isNavigatingRef.current) {
      releaseNavigation();
    }
  }, [pathname, releaseNavigation]);

  /*
   * Protecție împotriva setState după unmount și curățarea
   * timeout-ului când componenta dispare.
   */
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearSafetyTimeout();

      isNavigatingRef.current = false;
      activeNavigationIdRef.current = null;
    };
  }, [clearSafetyTimeout]);

  return {
    navigate,
    replace,
    runLocked,
    isNavigating,
  };
}
