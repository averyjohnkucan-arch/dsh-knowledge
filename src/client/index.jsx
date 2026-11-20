import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Knowledge } from './Knowledge.jsx';

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
    return (
      <button
        type="button"
        title="Knowledge"
        aria-label="Knowledge"
        onClick={() => change(true)}
        style={{
          background: 'none',
          border: 0,
          color: 'inherit',
          cursor: 'pointer',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span aria-hidden="true">▤</span>
        {wide && 'Knowledge'}
      </button>
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
  const add = (name, id, component) =>
    slots.inject(name, () =>
      slots.register({ name, id, order: 60, label: () => 'Knowledge' }, component),
    );
  add('sidebar.footer.action', 'knowledge', Action);
  add('shell.overlay', 'knowledge', Overlay);
  add('settings.section', 'knowledge-setup', Knowledge);
}
