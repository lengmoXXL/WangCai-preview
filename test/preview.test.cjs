const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createWorkspace, until, withWindow } = require('@lengmoxxl/wangcai-testkit');

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
  assert.equal(await panel(page).locator('.preview-name').innerText(), 'photo.png');
  assert.match(await image.getAttribute('src'), /^data:image\/png;base64,/);
  // The tab carries no address box and no refresh button.
  assert.equal(await panel(page).getByRole('textbox').count(), 0);
  assert.equal(await panel(page).getByRole('button').count(), 0);
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
  const names = () => panel(page).locator('.preview-name').allInnerTexts();
  // A workspace of its own, the file sent in the order the sender uses (the file first, then the tab), and the name
  // that tab ends up showing.
  const openWith = async (path, name) => {
    await createWorkspace(page);
    await send(page, { type: 'file', machine, path });
    await showView(page);
    await until(async () => (await names()).includes(name));
  };
  await openWith(first, 'first.md');
  await openWith(second, 'second.md');
  assert.deepEqual(await names(), ['first.md', 'second.md']);
  // A file that changes is read again by the tab showing it, whichever workspace that tab belongs to. The panels are
  // read as text, since the one in the workspace behind is hidden and has no place in the accessibility tree.
  const pages = () => panel(page).locator('.preview-markdown').allInnerTexts();
  writeFileSync(first, '# First page again\n\nfirst-body\n');
  await until(async () => (await pages()).some((text) => text.includes('First page again')));
  // And closing one tab leaves the other watching.
  await page.getByRole('button', { name: '关闭 预览', exact: true }).click();
  await until(async () => (await names()).length === 1);
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
