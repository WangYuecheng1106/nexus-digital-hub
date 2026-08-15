// 无障碍模态框：role=dialog、焦点陷阱、ESC 关闭、外点关闭、进出场动画
import React, { useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, width }) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const boxRef = useRef(null);

  // 出场动画：延迟卸载 140ms
  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return undefined;
    }
    if (!render) return undefined;
    setClosing(true);
    const t = setTimeout(() => { setRender(false); setClosing(false); }, 140);
    return () => clearTimeout(t);
  }, [open, render]);

  // 焦点陷阱 + ESC
  useEffect(() => {
    if (!render) return undefined;
    const box = boxRef.current;
    if (!box) return undefined;
    const prevFocus = document.activeElement;

    const focusables = () =>
      [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

    // 初始聚焦第一个可交互元素，否则聚焦对话框本体
    const first = focusables()[0];
    (first || box).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (i === -1 || i === list.length - 1)) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
    };
  }, [render, onClose]);

  if (!render) return null;

  return (
    <div className={`modal-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div
        ref={boxRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        style={width ? { width, minWidth: 0 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
