/**
 * Ask for a mistake reason (D-#937) the way useConfirm asks for a confirm: one sheet above
 * the navigator, `await askMistakeReason({...})` resolves the pick, or null on cancel /
 * backdrop / back button. The no-provider default resolves null (nothing is sent).
 */
import React from "react";
import { MistakeReasonSheet, type MistakeReasonPick, type MistakeReasonRequest } from "../components/MistakeReasonSheet";

type AskReason = (req: MistakeReasonRequest) => Promise<MistakeReasonPick | null>;

const MistakeReasonContext = React.createContext<{ askMistakeReason: AskReason }>({
  askMistakeReason: async () => null,
});

export function MistakeReasonProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [request, setRequest] = React.useState<MistakeReasonRequest | null>(null);
  // A second request supersedes an unanswered one (resolves it null).
  const pending = React.useRef<((pick: MistakeReasonPick | null) => void) | null>(null);

  const askMistakeReason = React.useCallback<AskReason>(
    (req) =>
      new Promise((resolve) => {
        pending.current?.(null);
        pending.current = resolve;
        setRequest(req);
      }),
    [],
  );

  const settle = React.useCallback((pick: MistakeReasonPick | null) => {
    pending.current?.(pick);
    pending.current = null;
    setRequest(null);
  }, []);

  const value = React.useMemo(() => ({ askMistakeReason }), [askMistakeReason]);

  return (
    <MistakeReasonContext.Provider value={value}>
      {children}
      <MistakeReasonSheet request={request} onCancel={() => settle(null)} onSubmit={(p) => settle(p)} />
    </MistakeReasonContext.Provider>
  );
}

export function useMistakeReason(): { askMistakeReason: AskReason } {
  return React.useContext(MistakeReasonContext);
}
