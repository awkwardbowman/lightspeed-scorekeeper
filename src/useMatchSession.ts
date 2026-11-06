import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "./Auth";
import { claim, newStandalone, type Claim } from "./db/traditional";
import { message, rpc } from "./data";
import { uid, type Match } from "./match";
export default function useMatchSession(match: Match) {
  const { profile } = useAccount();
  const remote = useRef<{ id: string; revision: number } | null>(null);
  const current = useRef(match);
  current.current = match;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState("Not started");
  const [failed, setFailed] = useState(false);
  // A fresh controller token prevents duplicated tabs from sharing a claim.
  const token = useRef(uid());
  const persist = useCallback(
    async (finalize = false, takeover = false) => {
      const snapshot = { ...current.current };
      const task = async () => {
        setStatus("Saving…");
        try {
          if (!remote.current || remote.current.id !== snapshot.id) {
            if (!snapshot.eventId) await newStandalone(snapshot, profile.id);
            const c = await claim(snapshot.id, token.current, takeover);
            remote.current = { id: snapshot.id, revision: c.revision };
          }
          const save = () =>
            rpc<Claim>("save_match", {
              p_match: {
                ...snapshot,
                remainingMs: Math.round(snapshot.remainingMs),
              },
              p_calls: snapshot.calls,
              p_token: token.current,
              p_revision: remote.current!.revision,
              p_finalize: finalize || Boolean(snapshot.finalized),
            });
          let saved: Claim;
          try {
            saved = await save();
          } catch (e) {
            // A lost response may have committed. Only the same secret claim
            // can reconcile its revision; a competing controller still fails.
            if (!/changed on another device|claim expired/i.test(message(e)))
              throw e;
            const refreshed = await claim(snapshot.id, token.current, false);
            remote.current = { id: snapshot.id, revision: refreshed.revision };
            saved = await save();
          }
          remote.current.revision = saved.revision;
          setStatus("Saved");
          setFailed(false);
          return true;
        } catch (e) {
          setStatus(`Save failed: ${message(e)}`);
          setFailed(true);
          throw e;
        }
      };
      const next = queue.current.then(task, task);
      queue.current = next;
      return next;
    },
    [profile.id],
  );
  useEffect(() => {
    if (!match.startedAt || match.finalized) return;
    const id = setTimeout(() => {
      void persist().catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [
    match.id,
    match.phase,
    match.calls,
    match.winnerSide,
    match.finalized,
    persist,
  ]);
  useEffect(() => {
    const id = setInterval(() => {
      if (current.current.startedAt && !current.current.finalized)
        void persist().catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [persist]);
  async function release() {
    if (remote.current) {
      await rpc("release_match", {
        p_id: remote.current.id,
        p_token: token.current,
      });
      remote.current = null;
    }
  }
  return {
    persist,
    release,
    status,
    failed,
    forget: () => {
      remote.current = null;
    },
  };
}
