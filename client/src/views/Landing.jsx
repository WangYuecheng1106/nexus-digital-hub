import React from 'react';
import { Icons } from '../icons.jsx';

export default function Landing({ onEnter }) {
  return (
    <div className="landing" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 40px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>
          <Icons.nexus size={22} stroke="var(--accent)" /> Nexus
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="#features" style={{ color: 'var(--text-secondary)', fontSize: 14, textDecoration: 'none' }}>功能</a>
          <a href="#download" style={{ color: 'var(--text-secondary)', fontSize: 14, textDecoration: 'none' }}>下载</a>
          <a href="https://github.com/WangYuecheng1106/nexus-digital-hub" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', fontSize: 14, textDecoration: 'none' }}>GitHub</a>
          <button type="button" className="btn-primary" onClick={onEnter} style={{ padding: '6px 14px', fontSize: 13 }}>进入工作台</button>
        </div>
      </header>

      <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 24 }}>
            对标钉钉 / WhatsApp / 华为 WeLink / Microsoft Viva Engage
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, marginBottom: 20, letterSpacing: '-0.03em' }}>
            数字中枢，All-in-One 企业协作入口
          </h1>
          <p style={{ fontSize: 18, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 32 }}>
            Nexus 把即时通讯、视频会议、文档协作、流程审批、关系图谱、项目管理、考勤、AI 助手
            整合进一个统一工作台。体验极致、高度智能、生态开放。
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button type="button" className="btn-primary" style={{ padding: '12px 24px', fontSize: 15 }} onClick={onEnter}>在线体验</button>
            <a href="https://github.com/WangYuecheng1106/nexus-digital-hub" target="_blank" rel="noreferrer" className="btn-default" style={{ padding: '12px 24px', fontSize: 15, textDecoration: 'none' }}>GitHub 源码</a>
          </div>
          <div className="text-xs" style={{ marginTop: 16, color: 'var(--text-muted)' }}>
            演示账号 admin / Admin@1234 · liuyang / Nexus@1234
          </div>
        </div>
      </section>

      <section id="features" style={{ padding: '80px 40px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="font-semi" style={{ fontSize: 14, textAlign: 'center', marginBottom: 40, color: 'var(--text-secondary)' }}>核心能力</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {[
              { icon: Icons.chat, t: '即时通讯', d: '钉钉风格语音气泡、已读回执、撤回、@提及、WhatsApp 式加好友' },
              { icon: Icons.video, t: '视频会议', d: '一对一/多人会议、屏幕共享、会议录制、WebRTC 实时通话' },
              { icon: Icons.graph, t: '关系图谱', d: '万级节点 Canvas 分层渲染、AI 整理项目人员、双击聚焦子图' },
              { icon: Icons.doc, t: '文档协作', d: 'Yjs CRDT 实时协同编辑、多人同时编辑无冲突' },
              { icon: Icons.check, t: '流程审批', d: '可视化表单、流程编排、逐级审批流转' },
              { icon: Icons.spark, t: 'AI 助手', d: '多国产模型切换（千问/DeepSeek/智谱/Kimi/豆包），管理员配置 API Key' },
              { icon: Icons.mail, t: '企业邮箱', d: 'IMAP/SMTP 可配置、MCP 工具面、本地演示收件箱' },
              { icon: Icons.globe, t: '企业论坛', d: '公司动态、技术分享、招聘内推、二手交易、生活杂谈' },
            ].map((f) => (
              <div key={f.t} className="card" style={{ textAlign: 'left', padding: 20 }}>
                <div style={{ color: 'var(--accent)', marginBottom: 10 }}><f.icon size={20} /></div>
                <div className="font-semi" style={{ marginBottom: 6 }}>{f.t}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="download" style={{ padding: '80px 40px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="font-semi" style={{ fontSize: 14, marginBottom: 16, color: 'var(--text-secondary)' }}>下载与部署</div>
          <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
            当前版本为 Web 桌面端演示。Windows 桌面版（Electron）与本地后端服务请按 README 启动。
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="https://github.com/WangYuecheng1106/nexus-digital-hub" target="_blank" rel="noreferrer" className="btn-primary" style={{ padding: '10px 20px', textDecoration: 'none' }}>克隆源码</a>
            <button type="button" className="btn-default" onClick={onEnter} style={{ padding: '10px 20px' }}>直接在线体验</button>
          </div>
        </div>
      </section>

      <footer style={{ padding: '30px 40px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Nexus 数字中枢 · 参考 <a href="https://www.dingtalk.com/" target="_blank" rel="noreferrer">钉钉</a>、WhatsApp、<a href="https://www.huaweicloud.com/product/welink.html" target="_blank" rel="noreferrer">华为 WeLink</a>、<a href="https://enablement.microsoft.com/zh-cn/viva/engage/" target="_blank" rel="noreferrer">Viva Engage</a>
        </div>
      </footer>
    </div>
  );
}
