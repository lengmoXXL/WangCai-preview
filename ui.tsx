import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceActive } from '@lengmoxxl/sdk';
import type { TabRecord, UiContext } from '@lengmoxxl/sdk/channel';
import { kindOf, machineKey, noPreview, type FileClick, type Font } from './shared';
import './style.css';

// The page Core serves for an HTML preview, which asks for its content and is handed it as a message.
let preview: { url: string; message: string };
let font: Font;
let activeWorkspaceId: string | undefined;
let context: UiContext;

// The file another plugin sent, and what reading it gave back.
type Shown = { file?: FileClick; text?: string; error?: string };
// One tab's worth of state: what it shows, which files it has shown in the order it showed them and where in that list
// it stands, how it is drawn, and the name it watches files by. A window keeps one tab per workspace, so this is what a
// workspace's preview has of its own.
type Tab = { shown: Shown; history: FileClick[]; index: number; paint: () => void; holder: string };
const tabs = new Map<string, Tab>();
// A file can be sent before its tab was opened, since the sender asks for the tab after sending the file: it waits
// here, per workspace, for the tab that will show it.
const waiting = new Map<string, FileClick>();

// What the tab is called, and the name it goes by in `init.ts` and in the tab it remembers.
const identity = { id: 'preview', title: '预览' };

// The name the sidebar's view menu lists this plugin by.
export const title = identity.title;

// Core passes a ui context in; this page reads the one `mount` kept.
export function open(_context: UiContext, record?: TabRecord) {
  if (!record || record.id === identity.id) openTab(record?.workspaceId ?? activeWorkspaceId);
}

const read = async (tab: Tab) => {
  const file = tab.shown.file;
  if (!file) return;
  let text: string | undefined;
  let error = '';
  try {
    text = await context.ui.request<string>('read', { machine: file.machine, path: file.path });
  } catch (problem) {
    error = (problem as Error).message;
  }
  // A read that answered after the tab moved on to another file says nothing about the file on show.
  if (tab.shown.file !== file) return;
  tab.shown.text = text;
  tab.shown.error = error;
  tab.paint();
};

// The key a workspace's tab is filed under: a tab opened before any workspace was selected has none, and that is a
// workspace like any other here.
const tabKey = (workspaceId?: string) => workspaceId ?? '';

// What this tab watches: one file, or nothing when it is given none.
const watch = (holder: string, file?: FileClick) => {
  void context.ui.request('watch', file ? { holder, machine: file.machine, path: file.path } : { holder }).catch(() => undefined);
};

// The tab draws the file it is given here: what was read of the old one is dropped, and a file this page draws is read
// and watched. A file it draws nothing for is not read, and the watch the tab had on the old one is given up.
const show = (tab: Tab, file: FileClick) => {
  tab.shown.file = file;
  tab.shown.text = undefined;
  tab.shown.error = '';
  tab.paint();
  if (kindOf(file.path) === 'other') {
    watch(tab.holder);
    return;
  }
  watch(tab.holder, file);
  void read(tab);
};

// Whether two visits are the same file: the same path on the same machine.
const sameFile = (a: FileClick, b: FileClick) => a.path === b.path && machineKey(a.machine) === machineKey(b.machine);

// A visit is a step of the tab's history: a file sent here or a link followed is shown, and remembered so the tab can walk
// back to what it showed before. The file already on show is the visit the history is on, so it is left alone.
const visit = (tab: Tab, file: FileClick) => {
  const standing = tab.history[tab.index];
  if (standing && sameFile(standing, file)) return;
  tab.history = [...tab.history.slice(0, tab.index + 1), file];
  tab.index++;
  show(tab, file);
};

// Walking the tab's history shows the visit it lands on again, read from the file as it stands now.
const step = (tab: Tab, by: number) => {
  const entry = tab.history[tab.index + by];
  if (!entry) return;
  tab.index += by;
  show(tab, entry);
};

// The path a link names, read against the page the link was written in: what follows a `?` or a `#` names no file of its
// own, and a path that does not start at the root is joined to the page's directory.
const linkPath = (href: string, page: FileClick) => {
  const named = href.split(/[?#]/)[0];
  if (!named) return undefined;
  let written = named;
  try {
    written = decodeURIComponent(named);
  } catch {
    // A name the browser cannot decode is taken as it was written, which is what the file is called.
  }
  const from = written.startsWith('/') ? '' : page.path.slice(0, page.path.lastIndexOf('/') + 1);
  const steps: string[] = [];
  for (const part of `${from}${written}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') steps.pop();
    else steps.push(part);
  }
  return `/${steps.join('/')}`;
};

// The click on a link in a page: an address is the browser's to open, a path is this tab's when the file is one it draws,
// and the plugins that draw the rest are asked for the rest.
const follow = async (tab: Tab, href: string) => {
  const page = tab.shown.file;
  if (!page) return;
  if (/^https?:/i.test(href)) {
    void context.host.open(href).catch(() => undefined);
    return;
  }
  // A scheme other than the web's is not this view's to open.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
  const path = linkPath(href, page);
  if (!path) return;
  const file: FileClick = { type: 'file', machine: page.machine, path };
  if (kindOf(path) !== 'other') {
    visit(tab, file);
    return;
  }
  // A name this view does not draw may be a directory, and the files view is the plugin that draws those.
  const directory = await context.ui.request<boolean | null>('stat', { machine: page.machine, path }).catch(() => null);
  // The tab may have moved on to another file while the machine answered: the link is then about a page that is gone.
  if (tab.shown.file !== page) return;
  void context.global.publish('onclick', { ...file, type: directory === true ? 'directory' : 'file' });
};

// A sent file goes to the tab of the workspace in front, which is the tab that then comes forward to show it.
const receive = (file: FileClick) => {
  const key = tabKey(activeWorkspaceId);
  const tab = tabs.get(key);
  if (tab) visit(tab, file);
  else waiting.set(key, file);
  void context.global.publish('core:show-view', { plugin: identity.id });
};

function openTab(workspaceId?: string) {
  const key = tabKey(workspaceId);
  const view: Tab = { shown: {}, history: [], index: -1, paint: () => {}, holder: `preview:${Math.random().toString(36).slice(2)}` };
  tabs.set(key, view);
  context.host.tabs({ ...identity, workspaceId, mount(container) {
    const root = createRoot(container);
    // The two steps are offered only where the history has a visit to land on.
    view.paint = () => root.render(<Page shown={view.shown}
      back={view.index > 0 ? () => step(view, -1) : undefined}
      forward={view.history[view.index + 1] ? () => step(view, 1) : undefined}
      follow={(href) => void follow(view, href)} />);
    view.paint();
    // A file that arrived before this tab was opened is what it starts with.
    const sent = waiting.get(key);
    if (sent) {
      waiting.delete(key);
      visit(view, sent);
    }
    return { dispose: () => {
      view.paint = () => {};
      root.unmount();
      if (tabs.get(key) === view) tabs.delete(key);
      watch(view.holder);
    } };
  } });
}

// The row on top of the page: the two steps through the tab's history, and the path of the file on show, in a box that is
// read and copied rather than written into.
function Header({ file, back, forward }: { file?: FileClick; back?: () => void; forward?: () => void }) {
  return <header className="preview-head">
    <button className="preview-icon" aria-label="后退" title="后退" disabled={!back} onClick={back}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3 2 8l5 5 M2 8h12" /></svg>
    </button>
    <button className="preview-icon" aria-label="前进" title="前进" disabled={!forward} onClick={forward}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9 3 5 5-5 5 M2 8h12" /></svg>
    </button>
    <input className="preview-path" aria-label="路径" title={file?.path ?? ''} value={file?.path ?? ''} readOnly />
  </header>;
}

// A click on a link in a page, which asks the tab where it goes.
type LinkClick = (href: string) => void;

function Page({ shown, back, forward, follow }: { shown: Shown; back?: () => void; forward?: () => void; follow: LinkClick }) {
  const file = shown.file;
  const kind = file && kindOf(file.path);
  return <section className="preview" aria-label={identity.title} style={{ fontFamily: font.family, fontSize: font.size }}>
    <Header file={file} back={back} forward={forward} />
    {shown.error ? <div className="preview-message" role="alert">{shown.error}</div>
      : !file ? <div className="preview-message">在 editor 里点「预览」把文件送到这里</div>
      : kind === 'other' ? <div className="preview-message">{noPreview}</div>
      : shown.text === undefined ? <div className="preview-message">正在读取…</div>
      : kind === 'image' ? <div className="preview-image"><img src={shown.text} alt={file.path} /></div>
      : kind === 'markdown' ? <MarkdownPage text={shown.text} onLink={follow} />
      : <HtmlFrame text={shown.text} />}
  </section>;
}

// The width a page takes is kept as the share of the tab it filled, so a tab that is widened or narrowed later keeps the
// line the reader chose.
const widthKey = 'preview-page-width';
const minPageWidth = 200;
const keptShare = () => {
  const kept = Number(localStorage.getItem(widthKey));
  return kept > 0 && kept <= 1 ? kept : 1;
};

// A page of Markdown fills the tab from its left edge, and the divider on the page's right narrows it when moved. A link
// in it asks the tab where it goes; the click itself takes nothing anywhere.
function MarkdownPage({ text, onLink }: { text: string; onLink: LinkClick }) {
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const dragged = useRef({ at: 0, width: 0 });

  // The room the page may take: the tab, less the width the divider takes.
  const room = () => Math.max(0, scroller.current!.clientWidth - divider.current!.offsetWidth);
  // The divider's range and the page's width are one thing, so paint writes both.
  const paint = (width: number) => {
    const painted = Math.min(room(), Math.max(minPageWidth, Math.round(width)));
    page.current!.style.width = `${painted}px`;
    divider.current!.setAttribute('aria-valuemin', String(minPageWidth));
    divider.current!.setAttribute('aria-valuemax', String(room()));
    divider.current!.setAttribute('aria-valuenow', String(painted));
  };
  // Moving the divider is what decides the width, so it is also what keeps it.
  const resize = (width: number) => {
    paint(width);
    localStorage.setItem(widthKey, String(page.current!.offsetWidth / room()));
  };

  useLayoutEffect(() => {
    const paintKept = () => paint(keptShare() * room());
    paintKept();
    const observer = new ResizeObserver(paintKept);
    observer.observe(scroller.current!);
    return () => observer.disconnect();
  }, []);

  return <div className="preview-scroll" ref={scroller}>
    <div className="preview-page-row">
      <article className="preview-markdown" ref={page}>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} onClick={(event) => {
          event.preventDefault();
          if (href) onLink(href);
        }}>{children}</a> }}>{text}</Markdown>
      </article>
      <div className="preview-divider" ref={divider} role="separator" aria-label="调整页面宽度" aria-orientation="vertical" tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          dragged.current = { at: event.clientX, width: page.current!.offsetWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            resize(dragged.current.width + event.clientX - dragged.current.at);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          resize(page.current!.offsetWidth + (event.key === 'ArrowRight' ? 20 : -20));
        }} />
    </div>
  </div>;
}

// The listener goes in before the frame loads, which is when the document asks for what to show.
function HtmlFrame({ text }: { text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const deliver = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (target && event.data === preview.message && event.source === target) target.postMessage(text, '*');
    };
    addEventListener('message', deliver);
    return () => removeEventListener('message', deliver);
  }, [text]);
  // The document asks for its content once, when it loads, so a changed page needs a document of its own: the text is
  // what tells React the frame is a different one.
  return <iframe key={text} className="preview-frame" ref={frame} title="HTML 预览" sandbox="allow-scripts" src={preview.url} />;
}

export function mount(_container: HTMLElement, ui: UiContext) {
  context = ui;
  font = ui.host.config.font;
  preview = ui.host.preview;
  ui.global.subscribe<WorkspaceActive | null>('workspace:active', (value) => {
    activeWorkspaceId = value?.workspaceId;
    // A file waits for the tab of the workspace it was sent from: once that workspace is left behind, it is stale.
    for (const key of [...waiting.keys()]) if (key !== tabKey(activeWorkspaceId)) waiting.delete(key);
  });
  void ui.global.publish('workspace:query', null);
  // What another plugin previews arrives here, and a watched file that changed is read again by the tab showing it.
  ui.global.subscribe<FileClick>('preview:open', receive);
  ui.ui.subscribe<string>('changed', (path) => {
    for (const tab of tabs.values()) if (tab.shown.file?.path === path) void read(tab);
  });
}
