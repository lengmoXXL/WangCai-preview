# 旺财预览视图（preview）

旺财右侧的预览视图：把图片、Markdown 与 HTML 单独渲染出来，文件被 watch 着，
磁盘上改了画面就跟着变，所以这里没有刷新按钮。

editor 里点「预览」，就把当前文件送到这里，标签页随之调到前面。页头是「后退」「前进」两个按钮和当前文件的路径
（只读，可以选中复制），不铺目录。

## 注册

在 `~/.config/wangcai/init.ts` 的 `tabs` 里把它和 editor 一起列上：

```ts
tabs: [
  { id: 'editor' },
  { id: 'preview' },
],
```

## 它怎么显示

| 文件 | 显示 |
| --- | --- |
| 图片（png、jpg、jpeg、gif、webp、svg、avif、bmp、ico） | 原图，比面板大的缩小到装得下，小的按原尺寸画 |
| Markdown | 渲染后的页面（GFM：表格、任务列表、删除线），从面板左边铺满，正文右边那条分割条拖动调宽（宽度按占面板的比例记住） |
| HTML | 在独立的沙箱 iframe 里运行，脚本照跑 |
| 其它 | 一行「这种文件没有预览」 |

## 链接

Markdown 里的链接点开时，去哪里由链接指向的东西决定：

| 链接 | 做什么 |
| --- | --- |
| `http://`、`https://` | 交给系统用浏览器打开 |
| 本机图片、Markdown、HTML（相对路径按当前文件所在目录算） | 在这个标签里打开，并记进它的历史 |
| 本机的其它文件、目录 | 交给画它们的插件：目录给 files，其余给 editor |
| 页内锚点（`#标题`） | 不动作 |

页头的「后退」「前进」走的就是这些点击留下的历史，也是 editor 送过来的文件留下的历史；没有可去的地方时，
按钮是灰的。

## 配置

上面那个条目可以带一个 `config`：

```ts
{ id: 'preview', config: { font: { size: 14, family: '"Noto Sans CJK SC", sans-serif' } } }
```

### `font`

预览页面里的文字，含页头那个路径框。HTML 预览在独立文档里，字体由 Core 给，不受这项影响。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `family` | `"DejaVuSansM Nerd Font Mono", monospace` | 字体族 |
| `size` | `13` | 字号（px） |
