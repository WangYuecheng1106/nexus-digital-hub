// 线框图标 — 替代 emoji，对齐 Cursor / IDE 式视觉语言
const S = ({ d, size = 16, stroke = 'currentColor', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

export const Icons = {
  home: (p) => <S d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z" {...p} />,
  chat: (p) => <S d="M21 12a8 8 0 01-8 8H7l-4 3V12a8 8 0 018-8h2a8 8 0 018 8z" {...p} />,
  video: (p) => <S d={<>
    <rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" />
  </>} {...p} />,
  user: (p) => <S d={<>
    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </>} {...p} />,
  doc: (p) => <S d={<>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" />
  </>} {...p} />,
  folder: (p) => <S d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" {...p} />,
  calendar: (p) => <S d={<>
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
  </>} {...p} />,
  check: (p) => <S d={<>
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l3 3 5-6" />
  </>} {...p} />,
  board: (p) => <S d={<>
    <rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="11" rx="1" />
  </>} {...p} />,
  clock: (p) => <S d={<>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </>} {...p} />,
  globe: (p) => <S d={<>
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
  </>} {...p} />,
  graph: (p) => <S d={<>
    <circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 11l7.3-4M8.2 13l7.3 4" />
  </>} {...p} />,
  chart: (p) => <S d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" {...p} />,
  spark: (p) => <S d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" {...p} />,
  settings: (p) => <S d={<>
    <circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>} {...p} />,
  search: (p) => <S d={<>
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </>} {...p} />,
  send: (p) => <S d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" {...p} />,
  plus: (p) => <S d="M12 5v14M5 12h14" {...p} />,
  chevronL: (p) => <S d="M15 6l-6 6 6 6" {...p} />,
  chevronR: (p) => <S d="M9 6l6 6-6 6" {...p} />,
  mic: (p) => <S d={<>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" />
  </>} {...p} />,
  cam: (p) => <S d={<>
    <path d="M2 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8z" /><path d="M16 10l5-2v8l-5-2" />
  </>} {...p} />,
  screen: (p) => <S d={<>
    <rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 22h8" />
  </>} {...p} />,
  phoneOff: (p) => <S d="M15.5 15.5L4 4M10 14l-6 2 2-6M14 10l6-2-2 6" {...p} />,
  hand: (p) => <S d="M8 11V6a1.5 1.5 0 013 0v5M11 11V5a1.5 1.5 0 013 0v6M14 11V7a1.5 1.5 0 013 0v8a5 5 0 01-5 5h-1a6 6 0 01-6-6v-3a1.5 1.5 0 013 0v2" {...p} />,
  record: (p) => <S d={<>
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </>} {...p} />,
  logout: (p) => <S d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" {...p} />,
  attach: (p) => <S d="M21.4 11.6l-8.5 8.5a5 5 0 01-7.1-7.1l9.2-9.2a3.2 3.2 0 014.5 4.5L10.3 17" {...p} />,
  image: (p) => <S d={<>
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
  </>} {...p} />,
  file: (p) => <S d={<>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
  </>} {...p} />,
  mail: (p) => <S d={<>
    <path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" />
  </>} {...p} />,
  nexus: (p) => <S d={<>
    <circle cx="12" cy="12" r="3" /><circle cx="5" cy="7" r="2" /><circle cx="19" cy="7" r="2" /><circle cx="5" cy="17" r="2" /><circle cx="19" cy="17" r="2" />
    <path d="M7 8l3 2.5M17 8l-3 2.5M7 16l3-2.5M17 16l-3-2.5" />
  </>} {...p} />,
  reply: (p) => <S d={<>
    <path d="M9 17l-5-5 5-5" /><path d="M20 18v-1a6 6 0 00-6-6H4" />
  </>} {...p} />,
  forward: (p) => <S d={<>
    <path d="M15 17l5-5-5-5" /><path d="M4 18v-1a6 6 0 016-6h10" />
  </>} {...p} />,
  copy: (p) => <S d={<>
    <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </>} {...p} />,
  trash: (p) => <S d={<>
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" />
  </>} {...p} />,
  x: (p) => <S d="M18 6L6 18M6 6l12 12" {...p} />,
  info: (p) => <S d={<>
    <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 11v5" />
  </>} {...p} />,
  warning: (p) => <S d={<>
    <path d="M12 3L2 20h20L12 3z" /><path d="M12 10v4M12 17.5h.01" />
  </>} {...p} />,
  todo: (p) => <S d={<>
    <path d="M9 11l2 2 4-4" /><rect x="3" y="3" width="18" height="18" rx="3" />
  </>} {...p} />,
  pin: (p) => <S d={<>
    <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3L9 3z" />
  </>} {...p} />,
  bell: (p) => <S d={<>
    <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2z" /><path d="M10 20a2 2 0 004 0" />
  </>} {...p} />,
  upload: (p) => <S d={<>
    <path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </>} {...p} />,
  enter: (p) => <S d={<>
    <path d="M20 4v6a2 2 0 01-2 2H4" /><path d="M9 7l-5 5 5 5" />
  </>} {...p} />,
};
