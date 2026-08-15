// ⌘K 命令面板（钉钉风格快捷启动器）：模糊搜索会话/联系人/模块/快捷操作
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';
import EmptyState from './EmptyState.jsx';

const MODULES = [
  { key: 'workbench', label: '工作台', kw: 'workbench home 首页', Icon: Icons.home },
  { key: 'im', label: '消息', kw: 'im chat 聊天 消息', Icon: Icons.chat },
  { key: 'mail', label: '邮箱', kw: 'mail 邮件', Icon: Icons.mail },
  { key: 'meeting', label: '会议', kw: 'meeting video 视频会议', Icon: Icons.video },
  { key: 'contacts', label: '通讯录', kw: 'contacts 联系人', Icon: Icons.user },
  { key: 'document', label: '文档', kw: 'doc document 文档', Icon: Icons.doc },
  { key: 'drive', label: '云盘', kw: 'drive file 云盘 文件', Icon: Icons.folder },
  { key: 'calendar', label: '日程', kw: 'calendar 日历 日程', Icon: Icons.calendar },
  { key: 'workflow', label: '审批', kw: 'workflow approval 审批 流程', Icon: Icons.check },
  { key: 'project', label: '项目', kw: 'project 项目 任务', Icon: Icons.board },
  { key: 'attendance', label: '考勤', kw: 'attendance 考勤 打卡', Icon: Icons.clock },
  { key: 'forum', label: '论坛', kw: 'forum 论坛 社区', Icon: Icons.globe },
  { key: 'knowledge', label: '关系图谱', kw: 'knowledge graph 图谱 关系', Icon: Icons.graph },
  { key: 'analytics', label: '数据分析', kw: 'analytics chart 分析', Icon: Icons.chart },
  { key: 'ai', label: 'AI 助手', kw: 'ai 人工智能', Icon: Icons.spark },
  { key: 'settings', label: '设置', kw: 'settings 设置', Icon: Icons.settings },
];

const QUICK_ACTIONS = [
  { id: 'act-approval', label: '创建审批', kw: '创建审批 审批 approval create', module: 'workflow', Icon: Icons.check },
  { id: 'act-meeting', label: '发起会议', kw: '发起会议 会议 meeting start', module: 'meeting', Icon: Icons.video },
  { id: 'act-schedule', label: '新建日程', kw: '新建日程 日程 calendar schedule', module: 'calendar', Icon: Icons.calendar },
];

// 轻量模糊匹配：先包含匹配（高分），再子序列匹配
function fuzzy(query, text) {
  if (!query) return { ok: true, score: 1 };
  const q = query.toLowerCase();
  const t = String(text || '').toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return { ok: true, score: 100 - at };
  let i = 0;
  let score = 0;
  for (const ch of t) {
    if (ch === q[i]) { i += 1; score += 2; }
    if (i === q.length) return { ok: true, score };
  }
  return { ok: false, score: 0 };
}

export default function CommandPalette({ navigate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [data, setData] = useState({ convs: [], contacts: [], todos: [] });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // 全局快捷键：Ctrl/Cmd+K 切换，自定义事件支持顶栏按钮触发
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('nexus:cmdk', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('nexus:cmdk', onOpen);
    };
  }, []);

  // 打开时拉取数据并聚焦输入框
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    api('/im/conversations').then((d) => setData((s) => ({ ...s, convs: Array.isArray(d) ? d : (d.items || []) }))).catch(() => {});
    api('/contacts/employees').then((d) => setData((s) => ({ ...s, contacts: Array.isArray(d) ? d : (d.items || []) }))).catch(() => {});
    api('/portal/todos').then((d) => setData((s) => ({ ...s, todos: Array.isArray(d) ? d : (d.items || []) }))).catch(() => {});
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const go = useCallback((module) => {
    setOpen(false);
    navigate?.(module);
  }, [navigate]);

  // 构建分组结果
  const sections = useMemo(() => {
    const q = query.trim();
    const match = (label, kw) => {
      const a = fuzzy(q, label);
      const b = fuzzy(q, kw);
      if (!a.ok && !b.ok) return null;
      return Math.max(a.score, b.score);
    };
    const out = [];

    const actions = QUICK_ACTIONS
      .map((a) => ({ ...a, score: match(a.label, a.kw) }))
      .filter((a) => a.score !== null)
      .sort((x, y) => y.score - x.score)
      .slice(0, 4);
    if (actions.length) {
      out.push({
        title: '快捷操作',
        items: actions.map((a) => ({
          id: a.id, label: a.label, sub: '操作', Icon: a.Icon, run: () => go(a.module),
        })),
      });
    }

    const mods = MODULES
      .map((m) => ({ ...m, score: match(m.label, m.kw) }))
      .filter((m) => m.score !== null)
      .sort((x, y) => y.score - x.score)
      .slice(0, q ? 5 : 6);
    if (mods.length) {
      out.push({
        title: '应用模块',
        items: mods.map((m) => ({
          id: `mod-${m.key}`, label: m.label, sub: '模块', Icon: m.Icon, run: () => go(m.key),
        })),
      });
    }

    const convs = data.convs
      .map((c) => ({ c, score: match(c.name || '会话', '') }))
      .filter((x) => x.score !== null)
      .sort((x, y) => y.score - x.score)
      .slice(0, 4);
    if (convs.length) {
      out.push({
        title: '最近会话',
        items: convs.map(({ c }) => ({
          id: `conv-${c.id}`, label: c.name || '会话', sub: '会话', Icon: Icons.chat, run: () => go('im'),
        })),
      });
    }

    const contacts = data.contacts
      .map((c) => ({ c, score: match(c.name || c.display_name || '', c.dept_name || '') }))
      .filter((x) => x.score !== null && (q ? true : false))
      .sort((x, y) => y.score - x.score)
      .slice(0, 4);
    if (contacts.length) {
      out.push({
        title: '联系人',
        items: contacts.map(({ c }) => ({
          id: `emp-${c.user_id || c.id}`, label: c.name || c.display_name, sub: c.dept_name || '同事', Icon: Icons.user, run: () => go('contacts'),
        })),
      });
    }

    if (q) {
      const todos = data.todos
        .map((t) => ({ t, score: match(t.title || '', t.label || '') }))
        .filter((x) => x.score !== null)
        .slice(0, 3);
      if (todos.length) {
        out.push({
          title: '待办',
          items: todos.map(({ t }, i) => ({
            id: `todo-${t.id || i}`, label: t.title || '待办事项', sub: t.label || '待办', Icon: Icons.todo, run: () => go('workflow'),
          })),
        });
      }
    }
    return out;
  }, [query, data, go]);

  // 扁平化可选条目（键盘导航用）
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  // 让高亮项保持可见
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIdx((cur) => (cur + dir + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[activeIdx]?.run();
    }
  };

  if (!open) return null;

  let itemOffset = 0;
  return createPortal(
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Icons.search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="搜索应用、会话、联系人，或执行快捷操作…"
            aria-label="搜索命令"
            role="combobox"
            aria-expanded="true"
            aria-activedescendant={flat[activeIdx]?.id}
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>
        <div className="cmdk-list scroll-y" ref={listRef} role="listbox">
          {flat.length === 0 && (
            <EmptyState
              compact
              icon={<Icons.search size={36} />}
              title="未找到相关结果"
              description="试试搜索「审批」「会议」等应用名，或同事姓名"
            />
          )}
          {sections.map((sec) => {
            const start = itemOffset;
            itemOffset += sec.items.length;
            return (
              <div key={sec.title}>
                <div className="cmdk-section">{sec.title}</div>
                {sec.items.map((it, i) => {
                  const idx = start + i;
                  return (
                    <button
                      key={it.id}
                      id={it.id}
                      type="button"
                      role="option"
                      aria-selected={idx === activeIdx}
                      className={`cmdk-item${idx === activeIdx ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={it.run}
                    >
                      <span className="cmdk-item-icon"><it.Icon size={14} /></span>
                      <span>{it.label}</span>
                      {it.sub && <span className="cmdk-item-sub">{it.sub}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="cmdk-footer">
          <span className="cmdk-hint"><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> 导航</span>
          <span className="cmdk-hint"><kbd className="cmdk-kbd">↵</kbd> 选择</span>
          <span className="cmdk-hint"><kbd className="cmdk-kbd">esc</kbd> 关闭</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
