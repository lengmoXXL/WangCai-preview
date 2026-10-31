import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceActive } from '@lengmoxxl/sdk';
import type { TabRecord, UiContext } from '@lengmoxxl/sdk/channel';
import { kindOf, noPreview, type FileClick, type Font } from './shared';
import './style.css';

// The page Core serves for an HTML preview, which asks for its content and is handed it as a message.
let preview: { url: string; message: string };
let font: Font;
let activeWorkspaceId: string | undefined;
let context: UiContext;

// The file another plugin sent, and what reading it gave back.
type Shown = { file?: FileClick; text?: string; error?: string };

// One tab's worth of state: what it shows, how it is drawn, and the name it watches files by. A window keeps one tab
// per workspace, so this is what a workspace's preview has of its own.
type Tab = { shown: Shown; paint: () => void; holder: string };
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
  // A read that answered after another file was sent is about a file that is no longer on show.
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

// A file sent here replaces the one on show: what was read of the old one is dropped, and a file this page draws is read
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

// A sent file goes to the tab of the workspace in front.
const receive = (file: FileClick) => {
  const key = tabKey(activeWorkspaceId);
  const tab = tabs.get(key);
  if (tab) return show(tab, file);
  waiting.set(key, file);
};

function openTab(workspaceId?: string) {
  const key = tabKey(workspaceId);
  const view: Tab = { shown: {}, paint: () => {}, holder: `preview:${Math.random().toString(36).slice(2)}` };
  tabs.set(key, view);
  context.host.tabs({ ...identity, workspaceId, mount(container) {
    const root = createRoot(container);
    view.paint = () => root.render(<Page shown={view.shown} />);
    view.paint();
    // A file that arrived before this tab was opened is what it starts with.
    const sent = waiting.get(key);
    if (sent) {
      waiting.delete(key);
      show(view, sent);
    }
    return { dispose: () => {
      view.paint = () => {};
      root.unmount();
      if (tabs.get(key) === view) tabs.delete(key);
      watch(view.holder);
    } };
  } });
}

function Page({ shown }: { shown: Shown }) {
  const file = shown.file;
  const kind = file && kindOf(file.path);
  return <section className="preview" aria-label={identity.title} style={{ fontFamily: font.family, fontSize: font.size }}>
    <header className="preview-head">
      <span className="preview-name" title={file?.path}>{file?.path.split('/').pop() ?? identity.title}</span>
    </header>
    {shown.error ? <div className="preview-message" role="alert">{shown.error}</div>
      : !file ? <div className="preview-message">在 files 里按 <kbd>&lt;C-p&gt;</kbd> 把文件送到这里</div>
      : kind === 'other' ? <div className="preview-message">{noPreview}</div>
      : shown.text === undefined ? <div className="preview-message">正在读取…</div>
      : kind === 'image' ? <div className="preview-image"><img src={shown.text} alt={file.path} /></div>
      : kind === 'markdown' ? <article className="preview-markdown">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span> }}>{shown.text}</Markdown>
      </article>
      : <HtmlFrame text={shown.text} />}
  </section>;
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
