import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Knowledge } from './Knowledge.jsx';
import footerStyles from './sidebar.css';

export const inject = ['slots'];
export function apply(ctx) {
  const slots = ctx.get('slots');
  const listeners = new Set();
  let open = false;
  function change(value) {
    open = value;
    for (const notify of listeners) notify();
  }
  function subscribe(notify) {
    listeners.add(notify);
    return () => listeners.delete(notify);
  }
  function Action({ wide }) {
    const expanded = useSyncExternalStore(subscribe, () => open);
    const size = wide ? 16 : 18;
    return (
      <>
        <style>{footerStyles}</style>
        <button
          type="button"
          className={wide ? 'kn-footer' : 'kn-footer kn-footer-rail'}
          title="Knowledge"
          aria-label="Knowledge"
          aria-haspopup="dialog"
          aria-expanded={expanded}
          onClick={() => change(!expanded)}
        >
          <svg
            aria-hidden="true"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          {wide && <span>Knowledge</span>}
        </button>
      </>
    );
  }
  function Overlay() {
    const visible = useSyncExternalStore(subscribe, () => open);
    const ref = useRef(null);
    useEffect(() => {
      if (visible) ref.current?.showModal();
    }, [visible]);
    return visible ? (
      <dialog
        className="kn-dialog"
        ref={ref}
        aria-label="Knowledge library"
        onClose={() => change(false)}
      >
        <button className="kn-close" onClick={() => ref.current.close()}>
          Close
        </button>
        <Knowledge />
      </dialog>
    ) : null;
  }
  const add = (name, id, order, component) =>
    slots.inject(name, () =>
      slots.register({ name, id, order, label: () => 'Knowledge' }, component),
    );
  add('sidebar.footer.action', 'knowledge', 10, Action);
  add('shell.overlay', 'knowledge', 10, Overlay);
  add('settings.section', 'knowledge-setup', 60, Knowledge);
}
