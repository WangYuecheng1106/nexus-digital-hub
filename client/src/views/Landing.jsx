import React, { useState } from 'react';
import { Icons } from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const CONSENT_KEY = 'nexus_legal_consent_v2026';

const SELLING = [
  { title: 'All-in-One 统一入口', desc: '消息、会议、文档、审批、云盘、考勤、图谱与 AI 共用一个登录与一套工作台，减少工具切换成本。' },
  { title: '对话即操作', desc: '「提醒我」「发消息给张三」「建日程」直接写入真实服务；有模型 Key 后，文档润色、听记、图谱整理走真实大模型。' },
  { title: '事在消息里闭环', desc: '审批通过回流工作通知，待办可跳回源模块，组织协作围绕消息与 Agent 完成，而不是散落在独立 Tab。' },
  { title: '可自托管的企业安全', desc: 'JWT RS256、RBAC、审计哈希链、数据本地 SQLite；适合私有化与客户 VPC，对标钉钉专有云诉求。' },
];

const MODULES = [
  { title: '工作台', pitch: '待办 · 日程 · 打卡 · 九宫格应用', img: './landing/workbench.png', points: ['骨架屏秒开', '待办深链', '健康状态总览'] },
  { title: '消息 IM', pitch: '文字 / 语音 / 图片 / 文件 / 撤回', img: './landing/im.png', points: ['右键转待办', '钉钉式撤回长条', '会话草稿'] },
  { title: 'Nexus AI', pitch: '千问办公同级 · AgentOS', img: './landing/ai.png', points: ['规则+模型双通道', '工具卡片', '填 Key 即用'] },
  { title: '视频会议', pitch: '会中画面 · 共享 · AI 听记', img: './landing/meeting.png', points: ['本地预览', '写入日历', '纪要整理'] },
  { title: '文档协作', pitch: 'Yjs 协同 · 云盘文件可预览', img: './landing/document.png', points: ['AI 摘要润色', '版本快照', '评论'] },
  { title: '流程审批', pitch: '模板 · 同意拒绝 · 工作通知', img: './landing/workflow.png', points: ['多模板', '动作回流 IM', '效率看板'] },
  { title: '关系图谱', pitch: '产品线→部门→小组→个人', img: './landing/knowledge.png', points: ['AI 整理人员', '节点弹窗', '适应画布'] },
  { title: '个人分析', pitch: '活跃 · 会议 · 审批 · 考勤', img: './landing/analytics.png', points: ['下钻', 'CSV 导出', '与个人资料结合'] },
  { title: '云盘', pitch: '拖拽上传 · 在文档中查看', img: './landing/drive.png', points: ['多文件', '配额', '预览跳转'] },
  { title: '邮箱', pitch: '自填 IMAP / 邮箱 MCP', img: './landing/mail.png', points: ['收发演示', 'MCP 工具面', 'AI 写信'] },
  { title: '日程', pitch: '月视图 · 会议块', img: './landing/calendar.png', points: ['新建弹窗', '与会议联动'] },
  { title: '考勤', pitch: '一键打卡 · 记录中文化', img: './landing/attendance.png', points: ['GPS 演示', '月度统计'] },
];

const DOCS = [
  { name: '产品说明（本页）', href: '#nx-modules', note: '功能矩阵与卖点总览' },
  { name: '使用指引', href: '#nx-howto', note: '演示账号、本机启动、模块入口' },
  { name: '用户协议与合规告知', href: '#nx-legal', note: '体验/下载前须阅读并同意' },
  { name: '隐私与数据处理说明', href: '#nx-privacy', note: '个人信息与生成式 AI 相关义务' },
  { name: '更新日志', href: '#nx-changelog', note: '近期能力发布记录' },
];

const LOG = [
  ['2026-08-13', 'Windows APP', '官网下载改为 Nexus 桌面客户端安装包；首页模块「关系图谱」。'],
  ['2026-08-13', '官网与合规', '卖点图文落地页；体验/下载前法律告知弹窗。'],
  ['2026-08-13', 'AI 生态', 'API Key 驱动文档润色、图谱整理、听记；对标钉钉千问办公。'],
  ['2026-08-13', '云盘 × 文档', '修复上传 multipart；云盘文件可在文档区预览。'],
  ['2026-08-12', '统一员工端', '去掉管理员皮肤与阅读水印。'],
];

const FEATURE_LIST = [
  '即时通讯（文字、语音、图片、文件、撤回、转待办）',
  '视频会议（会中预览、共享、听记草稿）',
  '文档协作（协同编辑、版本、AI 摘要/润色）与云盘预览',
  '流程审批、日程、考勤、通讯录、企业论坛',
  '关系图谱（组织层级整理、节点信息弹窗）',
  '个人/团队数据分析与导出',
  '邮箱 IMAP/SMTP 或用户自填 MCP',
  'AI AgentOS（对话即操作 + 国产大模型 Key）',
  '统一工作台、命令面板、Windows 桌面客户端 / 私有化部署',
];

export default function Landing({ onEnter, signedIn = false }) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [intent, setIntent] = useState('trial'); // trial | download
  const [checked, setChecked] = useState(false);

  const requestAccess = (next = 'trial') => {
    setIntent(next);
    setChecked(false);
    try {
      if (sessionStorage.getItem(CONSENT_KEY) === '1') {
        finish(next);
        return;
      }
    } catch { /* */ }
    setConsentOpen(true);
  };

  const finish = (next = intent) => {
    setConsentOpen(false);
    if (next === 'download') {
      const a = document.createElement('a');
      a.href = './downloads/Nexus-Setup.exe';
      a.download = 'Nexus-Setup.exe';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    onEnter?.();
  };

  const agree = () => {
    if (!checked) return;
    try { sessionStorage.setItem(CONSENT_KEY, '1'); } catch { /* */ }
    finish(intent);
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#/home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); if (window.location.hash !== '#/home') window.location.hash = '#/home'; }}>
          <Icons.nexus size={22} />
          <span>Nexus</span>
        </a>
        <nav className="landing-nav-links">
          <a href="#/home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); if (window.location.hash !== '#/home') window.location.hash = '#/home'; }}>首页</a>
          <a href="#nx-sell" onClick={(e) => { e.preventDefault(); document.getElementById('nx-sell')?.scrollIntoView({ behavior: 'smooth' }); }}>卖点</a>
          <a href="#nx-modules" onClick={(e) => { e.preventDefault(); document.getElementById('nx-modules')?.scrollIntoView({ behavior: 'smooth' }); }}>功能</a>
          <a href="#nx-howto" onClick={(e) => { e.preventDefault(); document.getElementById('nx-howto')?.scrollIntoView({ behavior: 'smooth' }); }}>使用</a>
          <a href="#nx-docs" onClick={(e) => { e.preventDefault(); document.getElementById('nx-docs')?.scrollIntoView({ behavior: 'smooth' }); }}>文档</a>
          <button type="button" className="btn-default landing-ghost-nav" onClick={() => requestAccess('download')}>下载</button>
          <button type="button" className="btn-ink landing-cta" onClick={() => requestAccess('trial')}>
            {signedIn ? '进入工作台' : '立即体验'}
          </button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden />
        <div className="landing-kicker">Nexus 数字中枢 · AI 时代工作方式</div>
        <h1>一个入口，做完组织里的事。</h1>
        <p>
          对标钉钉工作台与千问办公：协作、审批、知识与 Agent 长在同一产品里。
          你负责决定，系统负责执行。
        </p>
        <div className="landing-hero-actions">
          <button type="button" className="btn-ink landing-cta-lg" onClick={() => requestAccess('trial')}>
            {signedIn ? '进入工作台' : '免费试用'}
          </button>
          <button type="button" className="btn-default landing-ghost" onClick={() => requestAccess('download')}>下载 Windows 客户端</button>
        </div>
        <div className="landing-hero-note">演示账号 admin / Admin@1234 · 下载为 Nexus Windows APP；体验/下载前将确认合规告知</div>
        <figure className="landing-hero-shot">
          <img src="./landing/workbench.png" alt="Nexus 工作台界面" />
          <figcaption>统一工作台 · 待办 / 日程 / 应用九宫格</figcaption>
        </figure>
      </section>

      <section id="nx-sell" className="landing-section">
        <h2>为什么是 Nexus</h2>
        <p className="landing-lead">四条卖点，对应采购方最常问的「值不值得换工具」。</p>
        <div className="landing-sell-grid">
          {SELLING.map((s, i) => (
            <article key={s.title} className="landing-sell-card">
              <div className="landing-sell-no">0{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="nx-modules" className="landing-section" style={{ paddingTop: 0 }}>
        <h2>功能矩阵 · 图文对照</h2>
        <p className="landing-lead">下列截图来自本仓库真实体验路径，每一项都能点进产品试用。</p>
        <div className="landing-module-list">
          {MODULES.map((m, i) => (
            <article key={m.title} className={`landing-module-row${i % 2 ? ' rev' : ''}`}>
              <div className="landing-module-copy">
                <div className="landing-product-kicker">MODULE</div>
                <h3>{m.title}</h3>
                <p>{m.pitch}</p>
                <ul>
                  {m.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
                <button type="button" className="btn-primary" onClick={() => requestAccess('trial')}>体验此能力</button>
              </div>
              <figure className="landing-module-shot">
                <img src={m.img} alt={`${m.title} 界面截图`} loading="lazy" />
                <figcaption>{m.title}</figcaption>
              </figure>
            </article>
          ))}
        </div>
      </section>

      <section id="nx-howto" className="landing-section landing-howto">
        <h2>三分钟上手</h2>
        <div className="landing-howto-grid">
          <div>
            <div className="landing-sell-no">01</div>
            <h3>本机启动</h3>
            <p>下载 Windows 客户端双击安装，或开发者模式执行 <code>npm run dev</code> 后打开 localhost:5173，用 admin / Admin@1234 登录。</p>
          </div>
          <div>
            <div className="landing-sell-no">02</div>
            <h3>接通 AI</h3>
            <p>设置 → AI 模型，填写通义 / DeepSeek / 智谱等 Key，文档与图谱即走真实模型。</p>
          </div>
          <div>
            <div className="landing-sell-no">03</div>
            <h3>接通邮箱</h3>
            <p>邮箱页填写自己的 IMAP 或 MCP 地址，AI「写信」与收件箱共用配置。</p>
          </div>
        </div>
      </section>

      <section id="nx-changelog" className="landing-section" style={{ paddingTop: 0 }}>
        <h2>更新</h2>
        <div className="card" style={{ marginTop: 16 }}>
          {LOG.map(([d, t, b]) => (
            <div key={t} className="landing-log-row">
              <span className="text-xs">{d}</span>
              <div><b>{t}</b><div className="text-xs" style={{ marginTop: 2 }}>{b}</div></div>
            </div>
          ))}
        </div>
      </section>

      <section id="nx-docs" className="landing-section landing-docs">
        <h2>文档</h2>
        <p className="landing-lead">产品说明、使用指引与合规材料集中放在官网底部，便于采购与法务查阅。</p>
        <div className="landing-docs-table">
          {DOCS.map((d) => (
            <a
              key={d.name}
              href={d.href}
              className="landing-docs-row"
              onClick={(e) => {
                if (!d.href.startsWith('#')) return;
                e.preventDefault();
                const id = d.href.slice(1);
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <Icons.doc size={16} />
              <div>
                <div className="font-semi">{d.name}</div>
                <div className="text-xs">{d.note}</div>
              </div>
              <span className="text-xs">打开</span>
            </a>
          ))}
        </div>

        <div id="nx-legal" className="landing-legal-block">
          <h3>用户协议与合规告知（摘要）</h3>
          <p>
            Nexus 为演示/试用与可自托管的企业协作软件。正式对外提供生成式 AI 服务时，应依据
            《网络安全法》《数据安全法》《个人信息保护法》以及
            <a href="https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm" target="_blank" rel="noreferrer">《生成式人工智能服务管理暂行办法》</a>
            、人工智能生成合成内容标识及算法相关规定履行义务。完整条款在点击「体验/下载」时弹窗展示，须勾选同意后方可继续。
          </p>
        </div>

        <div id="nx-privacy" className="landing-legal-block">
          <h3>隐私与数据处理说明（摘要）</h3>
          <p>
            演示环境默认将业务数据保存在本机 SQLite；您自行填写的邮箱凭据与模型 API Key 仅用于您配置的用途。
            请勿上传国家秘密、核心商业秘密或未经授权的个人信息。生成内容须人工审阅，不得将 AI 输出直接作为最终法律、医疗或投资意见。
          </p>
        </div>
      </section>

      <footer className="landing-footer">
        <div>
          <div className="font-semi" style={{ marginBottom: 8 }}>Nexus</div>
          <div className="text-xs">统一员工协作台 · AI 时代工作方式</div>
        </div>
        <div className="text-xs" style={{ display: 'grid', gap: 6 }}>
          <div className="font-semi" style={{ color: 'var(--text)' }}>产品</div>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-sell')?.scrollIntoView({ behavior: 'smooth' })}>卖点</button>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-modules')?.scrollIntoView({ behavior: 'smooth' })}>功能</button>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-changelog')?.scrollIntoView({ behavior: 'smooth' })}>更新</button>
        </div>
        <div className="text-xs" style={{ display: 'grid', gap: 6 }}>
          <div className="font-semi" style={{ color: 'var(--text)' }}>文档</div>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-docs')?.scrollIntoView({ behavior: 'smooth' })}>文档索引</button>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-legal')?.scrollIntoView({ behavior: 'smooth' })}>合规告知</button>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => document.getElementById('nx-privacy')?.scrollIntoView({ behavior: 'smooth' })}>隐私说明</button>
        </div>
        <div className="text-xs" style={{ display: 'grid', gap: 6 }}>
          <div className="font-semi" style={{ color: 'var(--text)' }}>开始</div>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => requestAccess('trial')}>立即体验</button>
          <button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => requestAccess('download')}>下载 Windows APP</button>
        </div>
      </footer>

      <Modal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title={intent === 'download' ? '下载 Windows 客户端前请确认' : '体验前请确认'}
        width={640}
      >
        <div className="landing-consent">
          <div className="landing-consent-section">
            <h4>一、本项目包含的功能</h4>
            <ul>
              {FEATURE_LIST.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
          <div className="landing-consent-section">
            <h4>二、法律责任与合规告知（中国 · 2026 适用框架）</h4>
            <div className="landing-consent-scroll">
              <p>在您点击「同意并继续」前，请仔细阅读。本告知不构成正式法律意见，正式商用请咨询贵司法务并签署专项协议。</p>
              <p><b>1. 网络与数据安全。</b>使用本软件应遵守《中华人民共和国网络安全法》《中华人民共和国数据安全法》及《网络数据安全管理条例》等规定，不得利用本系统从事危害国家安全、破坏计算机信息系统、传播违法信息等活动。自托管部署时，运营方应履行等级保护、安全监测、重要数据识别与事件报告等法定义务。</p>
              <p><b>2. 个人信息保护。</b>处理员工通讯录、邮箱、考勤、聊天等内容时，应遵守《中华人民共和国个人信息保护法》：告知同意、最小必要、权限管控、保存期限与删除权。演示账号仅供体验，请勿录入真实敏感个人信息。涉及人脸、行踪轨迹等敏感个人信息的，须取得单独同意并采取更严格保护措施。</p>
              <p><b>3. 生成式人工智能（2026 适用框架）。</b>若启用第三方大模型 API，相关服务受《生成式人工智能服务管理暂行办法》及生成合成内容标识、算法备案等配套要求约束（视是否向境内公众提供服务而定）。您应：保证输入数据来源合法；对 AI 生成/合成内容进行显著标识与人工审阅；禁止生成违法不良信息；不得利用深度合成技术制作虚假信息误导公众；涉及舆论属性或社会动员能力服务时依法评估与备案。</p>
              <p><b>4. 商业秘密与知识产权。</b>您上传的文档、源码、图纸等仍归权利人所有。禁止上传无权处分的作品或侵犯他人知识产权的材料。AI 输出可能与已有作品相似，商用前请自行查重与权利确认。</p>
              <p><b>5. 演示软件免责。</b>当前版本含演示数据与本地存储，不提供生产级 SLA、等保测评结论或跨境数据传输合规背书。因配置错误、密钥泄露、第三方模型服务中断或您的违规使用造成的损失，由使用方自行承担。</p>
              <p><b>6. 未成年人与特殊行业。</b>本产品面向企业办公场景，不面向不满十四周岁的未成年人提供服务。医疗、金融、政务等强监管行业需满足行业额外规范后方可上线。</p>
              <p><b>7. 同意的效力。</b>勾选并同意即表示您已阅读上述功能范围与合规义务，并承诺合法合规使用；如不同意，请关闭本窗口并停止体验或下载。</p>
            </div>
          </div>
          <label className="landing-consent-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>我已阅读并同意功能说明及上述法律责任与合规告知</span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-default" onClick={() => setConsentOpen(false)}>不同意</button>
            <button type="button" className="btn-primary" disabled={!checked} onClick={agree}>
              同意并继续{intent === 'download' ? '下载 APP' : '体验'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
