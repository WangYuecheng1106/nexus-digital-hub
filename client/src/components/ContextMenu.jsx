// 通用右键上下文菜单：视口钳位、ESC/外点关闭、键盘导航、danger/divider 支持
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ items = [], children }) {
  const [pos, setPos] = useState(null); // { x, y } | null
  const [activeIdx, setActiveIdx] = useState(-1);
  const menuRef = useRef(null);

  const close = useCallback(() => setPos(null), []);

  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveIdx(-1);
    setPos({ x: e.clientX, y: e.clientY });
  };

  // 视口钳位：菜单不超出右/下边缘
  useLayoutEffect(() => {
    if (!pos || !menuRef.current) return;
    const r = menuRef.current.getBoundingClientRect();
    const x = Math.min(pos.x, Math.max(8, window.innerWidth - r.width - 8));
    const y = Math.min(pos.y, Math.max(8, window.innerHeight - r.height - 8));
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
  }, [pos]);

  useEffect(() => {
    if (!pos) return undefined;
    const selectableIdx = items
      .map((it, i) => (it.type === 'divider' ? null : i))
      .filter((i) => i !== null);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!selectableIdx.length) return;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setActiveIdx((cur) => {
          const at = selectableIdx.indexOf(cur);
          return selectableIdx[(at + dir + selectableIdx.length) % selectableIdx.length];
        });
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        const item = items[activeIdx];
        close();
        item?.onClick?.();
      }
    };
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) close();
    };
    const onScrollOrResize = () => close();

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('blur', onScrollOrResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('blur', onScrollOrResize);
    };
  }, [pos, items, activeIdx, close]);

  return (
    <>
      <div onContextMenu={open} style={{ display: 'contents' }}>
        {children}
      </div>
      {pos && createPortal(
        <div
          ref={menuRef}
          className="ctx-menu"
          role="menu"
          aria-orientation="vertical"
          style={{ left: pos.x, top: pos.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((it, i) =>
            it.type === 'divider' ? (
              <div key={i} className="ctx-menu-divider" role="separator" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`ctx-menu-item${it.danger ? ' danger' : ''}${i === activeIdx ? ' active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { close(); it.onClick?.(); }}
              >
                {it.icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{it.icon}</span>}
                <span>{it.label}</span>
              </button>
            ),
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
