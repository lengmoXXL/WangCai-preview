import type { FileClick } from '@lengmoxxl/sdk';
export type { FileClick } from '@lengmoxxl/sdk';

// The font the text of a previewed file is drawn in, which main.ts declares the schema for.
export type Font = { family: string; size: number };

// What this plugin says about a file it has no view for, in the page and in the answer to reading one.
export const noPreview = '这种文件没有预览';

// The identity of a machine: the id, plus the host that tells two machines with one id apart.
export const machineKey = (machine: FileClick['machine']) => `${machine.id}|${machine.host ?? ''}`;

// Chromium renders these straight from a data URL.
const imageTypes: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon',
  jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
};
export const imageMime = (path: string) => imageTypes[path.split('.').pop()?.toLowerCase() ?? ''];

// How a file is shown: a picture, a page written in Markdown, a page of its own, or nothing this view can read.
type Kind = 'image' | 'markdown' | 'html' | 'other';
export const kindOf = (path: string): Kind => imageMime(path) ? 'image'
  : /\.(md|markdown)$/i.test(path) ? 'markdown'
  : /\.html?$/i.test(path) ? 'html'
  : 'other';
