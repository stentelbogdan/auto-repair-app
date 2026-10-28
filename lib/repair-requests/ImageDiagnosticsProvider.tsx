'use client';
import { createContext, useContext, useMemo } from 'react';
import { createImageDiagnostic, type ImageDiagnostic } from './image-deletion-diagnostics';
const Context = createContext<ImageDiagnostic>(() => {});
export function ImageDiagnosticsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const diagnostic = useMemo(() => createImageDiagnostic(enabled, (...args) => console.info(...args)), [enabled]);
  return <Context.Provider value={diagnostic}>{children}</Context.Provider>;
}
export function useImageDiagnostic() { return useContext(Context); }
