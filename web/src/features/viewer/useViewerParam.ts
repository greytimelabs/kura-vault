import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

const PARAM = 'v';

/**
 * The open photo lives in the URL (?v=<id>) so Back closes the viewer and the
 * grid underneath keeps its scroll position.
 */
export function useViewerParam() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openedHere = (location.state as { viewer?: boolean } | null)?.viewer === true;

  const open = useCallback(
    (id: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set(PARAM, id);
          return next;
        },
        { state: { viewer: true } },
      );
    },
    [setParams],
  );

  /** Move to another photo without adding a history entry per photo. */
  const show = useCallback(
    (id: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set(PARAM, id);
          return next;
        },
        { replace: true, state: location.state },
      );
    },
    [setParams, location.state],
  );

  const viewerId = params.get(PARAM);

  // Going back is asynchronous. Until the parameter is actually gone, a second
  // close (Escape then a click, or the list changing underneath) must not step
  // back through history again.
  const closing = useRef(false);
  useEffect(() => {
    if (!viewerId) closing.current = false;
  }, [viewerId]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (openedHere) {
      navigate(-1);
      return;
    }
    // Arrived by a link or a reload: there is no entry of ours to go back to
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(PARAM);
        return next;
      },
      { replace: true },
    );
  }, [openedHere, navigate, setParams]);

  return { viewerId, open, show, close };
}
