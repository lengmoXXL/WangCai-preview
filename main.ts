import type { MachineConnection } from '@lengmoxxl/sdk';
import type { MainContext } from '@lengmoxxl/sdk/channel';
import { imageMime, machineKey, noPreview, type FileClick } from './shared';

// The font init.ts may set, which reaches the text this page draws. An HTML page is a document of Core's own, so it
// keeps Core's font.
export const config = {
  font: {
    family: { type: 'string', default: '"DejaVuSansM Nerd Font Mono", monospace' },
    size: { type: 'number', default: 13 },
  },
};

export function activate(context: MainContext) {
  const pending = new Set<AbortController>();
  const connections = new Set<MachineConnection>();

  // One request runs on its own connection to a machine, closed again at the end unless the body keeps it: a holder
  // that watches a file holds its connection for as long as it watches.
  const withConnection = async <T>(machine: FileClick['machine'], body: (connection: MachineConnection, keep: () => void) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    pending.add(controller);
    let connection: MachineConnection | undefined;
    let kept = false;
    try {
      connection = await context.connect(machine, controller.signal);
      controller.signal.throwIfAborted();
      connections.add(connection);
      return await body(connection, () => { kept = true; });
    } finally {
      if (!kept && connection) {
        connection.disconnect();
        connections.delete(connection);
      }
      pending.delete(controller);
    }
  };

  // A picture crosses the channel as a data URL, which the renderer draws as it is; anything else is its text, and a
  // file that is neither is one this plugin cannot draw.
  const stopRead = context.ui.handle('read', ({ machine, path }: { machine: FileClick['machine']; path: string }) =>
    withConnection(machine, async (connection) => {
      const bytes = await connection.fs.readFile(path);
      const image = imageMime(path);
      if (image) return `data:${image};base64,${Buffer.from(bytes).toString('base64')}`;
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error(noPreview);
      }
    }));

  // One watch per holder, and each preview tab has one: what a tab watched before is given up as it starts watching
  // what it shows now, so a file that changes after it was replaced publishes nothing.
  const watchers = new Map<string, { key: string; connection: MachineConnection; close: () => void }>();
  const asked = new Map<string, string>();
  const giveUp = (holder: string) => {
    const previous = watchers.get(holder);
    if (!previous) return;
    previous.close();
    previous.connection.disconnect();
    connections.delete(previous.connection);
    watchers.delete(holder);
  };
  const stopWatch = context.ui.handle('watch', async ({ holder, machine, path }: { holder: string; machine?: FileClick['machine']; path?: string }) => {
    if (machine === undefined || path === undefined) {
      asked.delete(holder);
      giveUp(holder);
      return;
    }
    const key = `${machineKey(machine)}|${path}`;
    if (watchers.get(holder)?.key === key) return;
    asked.set(holder, key);
    giveUp(holder);
    await withConnection(machine, async (connection, keep) => {
      const close = await connection.fs.watch(path, {}, () => context.ui.publish('changed', path)).catch(() => undefined);
      // A later request from the same holder took the set over while this one was connecting.
      if (!close || asked.get(holder) !== key || watchers.has(holder)) {
        close?.();
        return;
      }
      keep();
      watchers.set(holder, { key, connection, close });
    });
  });

  return async () => {
    stopRead();
    stopWatch();
    for (const controller of pending) controller.abort();
    for (const holder of [...watchers.keys()]) giveUp(holder);
    for (const connection of connections) connection.disconnect();
  };
}
