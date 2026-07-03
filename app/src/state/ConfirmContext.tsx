/**
 * Confirm-before-destructive (UX-1, house rule R-Confirm —
 * docs/prd-ux-improvements.md §3/§4.1): every `variant="danger"` action passes
 * through `useConfirm().confirmAction(...)` as its first line —
 * `if (!(await confirmAction({...}))) return;` — so nothing mutates on a single
 * mis-tap. Renders components/ConfirmSheet; promise resolves true on confirm,
 * false on cancel/backdrop/back-button. The no-provider default resolves false
 * (fail-closed: no destructive action without an explicit confirm).
 */
import React from "react";
import { ConfirmSheet, type ConfirmTone } from "../components/ConfirmSheet";

export type ConfirmOptions = {
  title?: string;
  message?: string;
  confirmLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmState = { confirmAction: (opts: ConfirmOptions) => Promise<boolean> };

const ConfirmContext = React.createContext<ConfirmState>({
  confirmAction: async () => false,
});

export function ConfirmProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  // The unresolved promise's resolve fn — a ref, not state, so settling can never
  // race a re-render. A second request supersedes an unanswered one (resolves it false).
  const pendingResolve = React.useRef<((ok: boolean) => void) | null>(null);

  const confirmAction = React.useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        pendingResolve.current?.(false);
        pendingResolve.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const settle = React.useCallback((ok: boolean) => {
    pendingResolve.current?.(ok);
    pendingResolve.current = null;
    setOpts(null);
  }, []);

  const value = React.useMemo(() => ({ confirmAction }), [confirmAction]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmSheet
        visible={opts !== null}
        title={opts?.title}
        message={opts?.message}
        confirmLabel={opts?.confirmLabel}
        tone={opts?.tone ?? "danger"}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmState {
  return React.useContext(ConfirmContext);
}
