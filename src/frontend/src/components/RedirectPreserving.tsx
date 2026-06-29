import { Navigate } from 'react-router';

interface RedirectPreservingProps {
  /** Target path; the current `?search` and `#hash` are appended verbatim. */
  to: string;
}

/**
 * `<Navigate replace>` that carries the current querystring AND hash to the
 * target. The legacy `/wissensbasis` redirect only forwarded `search` — but
 * inbound deep-links like `/brain/fristen#frist-42` and
 * `/knowledge?doc=7#fakten` need the hash too, or they land on the new lens
 * without scrolling to / highlighting the target.
 */
export default function RedirectPreserving({ to }: RedirectPreservingProps) {
  const { search, hash } = window.location;
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
