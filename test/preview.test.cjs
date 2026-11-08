const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { until, withWindow } = require('@lengmoxxl/wangcai-testkit');

// What a case does to the window's own chrome.
//
// The menu that makes a workspace is the space under the rows: the rows have to end above the list's bottom edge, so the
// click lands on the list rather than on a row.
const openWorkspaceMenu = async (page) => {
  const list = page.locator('.workspaces');
  const box = await list.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4, { button: 'right' });
};

/** Opens a local workspace, and waits for the shell its pane draws a moment after the workspace appears. */
const createWorkspace = async (page) => {
  await openWorkspaceMenu(page);
  await page.locator('#workspace-row-menu').getByRole('menuitem', { name: '新建 本机', exact: true }).click();
  await page.locator('.terminal-pane.active .xterm-screen').filter({ hasText: /\S/ }).waitFor();
};

// What a case's window lists: this view, and the workspace whose machine a file is read on.
const lists = { workspaces: ['terminal-agent'], tabs: ['preview'] };

const machine = { id: 'local', name: '本机' };
const send = (page, file) => page.evaluate((value) => window.wangcai.call('publish', 'preview:open', value), file);

const panel = (page) => page.locator('.sidebar-panel[data-plugin=preview]');

// Opening the tab is Core's to do, since Core draws it.
const showView = (page) => page.evaluate(() => window.wangcai.call('publish', 'core:show-view', { plugin: 'preview' }));

// The workspace the window needs, and the tab opened on it.
const openPreview = async (page) => {
  await createWorkspace(page);
  await showView(page);
  await panel(page).waitFor();
};

// A one-pixel PNG, which is all a case needs to see the picture path work.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('a previewed picture is drawn as it is, and read again when the file changes', { timeout: 180000 }, () => withWindow('wangcai-preview-image', lists, async ({ home, page, errors }) => {
  const picture = join(home, 'photo.png');
  writeFileSync(picture, png);
  await openPreview(page);
  await send(page, { type: 'file', machine, path: picture });
  const image = panel(page).locator('.preview-image img');
  await image.waitFor();
  assert.match(await image.getAttribute('src'), /^data:image\/png;base64,/);
  // The header reads the path of the file on show, and offers no step while the tab has one file in its history.
  assert.equal(await panel(page).locator('.preview-path').inputValue(), picture);
  assert.equal(await panel(page).getByRole('button', { name: '后退' }).isDisabled(), true);
  assert.equal(await panel(page).getByRole('button', { name: '前进' }).isDisabled(), true);
  // A file that changes on disk is read again without anyone asking: the bytes are what the page holds, so a new
  // file is a new data URL.
  const before = await image.getAttribute('src');
  writeFileSync(picture, Buffer.concat([png, Buffer.from('\n')]));
  await until(async () => (await image.getAttribute('src')) !== before);
  assert.deepEqual(errors, []);
}));

test('a previewed page is rendered, and a file it cannot read says so', { timeout: 180000 }, () => withWindow('wangcai-preview-pages', lists, async ({ home, page, errors }) => {
  const written = join(home, 'notes.md');
  writeFileSync(written, '# Notes title\n\nbody with **weight**\n');
  const binary = join(home, 'blob.bin');
  writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
  await openPreview(page);
  await send(page, { type: 'file', machine, path: written });
  await panel(page).getByRole('heading', { name: 'Notes title' }).waitFor();
  assert.equal(await panel(page).locator('.preview-markdown strong').innerText(), 'weight');
  // A file with nothing to show keeps the tab readable rather than drawing nonsense.
  await send(page, { type: 'file', machine, path: binary });
  await panel(page).locator('.preview-message').filter({ hasText: '这种文件没有预览' }).waitFor();
  assert.deepEqual(errors, []);
}));

test('a page fills the tab from its left edge, the divider on the right of the page narrows it, and the tab is what scrolls', { timeout: 180000 }, () => withWindow('wangcai-preview-width', lists, async ({ home, page, errors }) => {
  const written = join(home, 'wide.md');
  writeFileSync(written, `# Wide title\n\n${'body '.repeat(200)}\n`);
  await openPreview(page);
  await send(page, { type: 'file', machine, path: written });
  await panel(page).getByRole('heading', { name: 'Wide title' }).waitFor();
  const scroller = panel(page).locator('.preview-scroll');
  const article = panel(page).locator('.preview-markdown');
  const divider = panel(page).locator('.preview-divider');
  // Until the divider moves, the page takes the whole tab, flush with its left edge.
  await until(async () => Math.abs((await article.boundingBox()).width + (await divider.boundingBox()).width - (await scroller.evaluate((element) => element.clientWidth))) < 2);
  const startBox = await article.boundingBox();
  assert.ok(Math.abs(startBox.x - (await scroller.boundingBox()).x) < 1);
  // Dragged in, the page is narrower and still starts where it did, and the share it now takes is what is kept.
  const dividerBox = await divider.boundingBox();
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x - 200, dividerBox.y + 20, { steps: 4 });
  await page.mouse.up();
  await until(async () => (await article.boundingBox()).width < startBox.width - 150);
  assert.ok(Math.abs((await article.boundingBox()).x - startBox.x) < 1);
  const measured = await page.evaluate(() => {
    const article = document.querySelector('.preview-markdown');
    const scroller = document.querySelector('.preview-scroll');
    const room = scroller.clientWidth - document.querySelector('.preview-divider').offsetWidth;
    return {
      kept: Number(localStorage.getItem('preview-page-width')),
      drawn: article.offsetWidth / room,
      // The page beside the divider does not scroll itself; the tab does.
      tabScrolls: scroller.scrollHeight > scroller.clientHeight && article.scrollHeight === article.clientHeight,
    };
  });
  assert.ok(Math.abs(measured.kept - measured.drawn) < 0.01);
  assert.ok(measured.tabScrolls);
  assert.deepEqual(errors, []);
}));

test('a window with two workspaces keeps a preview of its own in each', { timeout: 180000 }, () => withWindow('wangcai-preview-tabs', lists, async ({ home, page, errors }) => {
  const first = join(home, 'first.md');
  const second = join(home, 'second.md');
  writeFileSync(first, '# First page\n\nfirst-body\n');
  writeFileSync(second, '# Second page\n\nsecond-body\n');
  const paths = () => panel(page).locator('.preview-path').evaluateAll((boxes) => boxes.map((box) => box.value));
  // A workspace of its own, the file sent in the order the sender uses (the file first, then the tab), and the path
  // that tab ends up showing.
  const openWith = async (path) => {
    await createWorkspace(page);
    await send(page, { type: 'file', machine, path });
    await showView(page);
    await until(async () => (await paths()).includes(path));
  };
  await openWith(first);
  await openWith(second);
  assert.deepEqual(await paths(), [first, second]);
  // A file that changes is read again by the tab showing it, whichever workspace that tab belongs to. The panels are
  // read as text, since the one in the workspace behind is hidden and has no place in the accessibility tree.
  const pages = () => panel(page).locator('.preview-markdown').allInnerTexts();
  writeFileSync(first, '# First page again\n\nfirst-body\n');
  await until(async () => (await pages()).some((text) => text.includes('First page again')));
  // And closing one tab leaves the other watching.
  await page.getByRole('button', { name: '关闭 预览', exact: true }).click();
  await until(async () => (await paths()).length === 1);
  writeFileSync(first, '# First page a third time\n\nfirst-body\n');
  await until(async () => (await pages()).some((text) => text.includes('First page a third time')));
  assert.deepEqual(errors, []);
}));

test('a page of its own is shown again when the file changes', { timeout: 180000 }, () => withWindow('wangcai-preview-html-watch', lists, async ({ home, page, errors }) => {
  const html = join(home, 'page.html');
  writeFileSync(html, '<!doctype html><html><body><h1>First title</h1></body></html>');
  await openPreview(page);
  await send(page, { type: 'file', machine, path: html });
  const frame = panel(page).locator('.preview-frame').contentFrame();
  await frame.getByRole('heading', { name: 'First title' }).waitFor();
  writeFileSync(html, '<!doctype html><html><body><h1>Second title</h1></body></html>');
  await frame.getByRole('heading', { name: 'Second title' }).waitFor();
  assert.deepEqual(errors, []);
}));

// A click in a page is the tab's to answer: a path it draws is shown here, and a path it does not draw is handed to the
// plugins that do. A click on an address asks the system for a browser, which is why no case here makes one.
test('a link to a file this view draws opens it here, and the two steps walk back out of it', { timeout: 180000 }, () => withWindow('wangcai-preview-links', lists, async ({ home, page, errors }) => {
  const directory = join(home, 'notes');
  const first = join(directory, 'first.md');
  const second = join(directory, 'second.md');
  mkdirSync(directory);
  writeFileSync(first, '# First title\n\n[next](second.md)\n\n[place](#first-title)\n');
  writeFileSync(second, '# Second title\n\nbody\n');
  await openPreview(page);
  await send(page, { type: 'file', machine, path: first });
  await panel(page).getByRole('heading', { name: 'First title' }).waitFor();
  const path = () => panel(page).locator('.preview-path').inputValue();
  // A place inside the page itself is nowhere else to go.
  await panel(page).getByRole('link', { name: 'place' }).click();
  assert.equal(await path(), first);
  // A relative path is read against the file the link was written in, and drawn here rather than elsewhere.
  await panel(page).getByRole('link', { name: 'next' }).click();
  await panel(page).getByRole('heading', { name: 'Second title' }).waitFor();
  assert.equal(await path(), second);
  // The steps walk the history the clicks made, and each one is the file as it stands now.
  await panel(page).getByRole('button', { name: '后退' }).click();
  await panel(page).getByRole('heading', { name: 'First title' }).waitFor();
  assert.equal(await path(), first);
  await panel(page).getByRole('button', { name: '前进' }).click();
  await panel(page).getByRole('heading', { name: 'Second title' }).waitFor();
  assert.equal(await path(), second);
  assert.deepEqual(errors, []);
}));

test('a link this view does not draw is handed to the plugin that does', { timeout: 180000 }, () => withWindow('wangcai-preview-links-out', lists, async ({ home, page, errors }) => {
  const written = join(home, 'out.md');
  mkdirSync(join(home, 'sub'));
  writeFileSync(join(home, 'code.ts'), 'export {};\n');
  writeFileSync(written, '# Out title\n\n[folder](sub/)\n\n[code](./code.ts)\n');
  await openPreview(page);
  // What the plugins that draw a directory and a source file are told, in the order the clicks tell them.
  await page.evaluate(() => {
    window.clicks = [];
    window.wangcai.subscribe('onclick', (file) => window.clicks.push({ type: file.type, path: file.path }));
  });
  await send(page, { type: 'file', machine, path: written });
  await panel(page).getByRole('heading', { name: 'Out title' }).waitFor();
  await panel(page).getByRole('link', { name: 'folder' }).click();
  await panel(page).getByRole('link', { name: 'code' }).click();
  await until(async () => (await page.evaluate(() => window.clicks)).length === 2);
  assert.deepEqual(await page.evaluate(() => window.clicks), [
    { type: 'directory', path: join(home, 'sub') },
    { type: 'file', path: join(home, 'code.ts') },
  ]);
  // The page stays where it was: neither click was this view's to draw.
  assert.equal(await panel(page).locator('.preview-path').inputValue(), written);
  assert.deepEqual(errors, []);
}));
