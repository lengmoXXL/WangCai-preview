# 旺财预览视图（preview）

旺财右侧的预览视图：把图片、Markdown 与 HTML 单独渲染出来，文件被 watch 着，
磁盘上改了画面就跟着变，所以这里没有刷新按钮。

它不铺目录、也不放地址框：别的插件（比如 files）在文件上按 `<C-p>` 就把文件送到这里，标签页随之调到前面。

## 注册

在 `~/.config/wangcai/init.ts` 的 `tabs` 里把它和 files 一起列上：

```ts
tabs: [
  { id: 'files' },
  { id: 'preview' },
],
```

## 它怎么显示

| 文件 | 显示 |
| --- | --- |
| 图片（png、jpg、jpeg、gif、webp、svg、avif、bmp、ico） | 原图，比面板大的缩小到装得下，小的按原尺寸画 |
| Markdown | 渲染后的页面（GFM：表格、任务列表、删除线） |
| HTML | 在独立的沙箱 iframe 里运行，脚本照跑 |
| 其它 | 一行「这种文件没有预览」 |

## 配置

上面那个条目可以带一个 `config`：

```ts
{ id: 'preview', config: { font: { size: 14, family: '"Noto Sans CJK SC", sans-serif' } } }
```

### `font`

预览页面里的文字，含页头那个文件名。HTML 预览在独立文档里，字体由 Core 给，不受这项影响。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `family` | `"DejaVuSansM Nerd Font Mono", monospace` | 字体族 |
| `size` | `13` | 字号（px） |
