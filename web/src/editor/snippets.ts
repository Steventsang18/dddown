/**
 * Markdown 代码片段库：prefix 触发 + Tab 确认 + 编号字段占位符跳转。
 * body 使用 CM6 snippet 语法：${1:默认值} 编号字段，\n 换行，\$ 转义字面 $。
 */

export interface Snippet {
  prefix: string;
  label: string;
  body: string;
  /** 仅当光标位于行首（该行无其他字符）时触发 */
  lineStart?: boolean;
  detail?: string;
}

export const SNIPPETS: Snippet[] = [
  // ========== 标题 ==========
  { prefix: '#', label: '标题 1', body: '# ${title}', lineStart: true },
  { prefix: '##', label: '标题 2', body: '## ${title}', lineStart: true },
  { prefix: '###', label: '标题 3', body: '### ${title}', lineStart: true },
  { prefix: '####', label: '标题 4', body: '#### ${title}', lineStart: true },
  { prefix: '#####', label: '标题 5', body: '##### ${title}', lineStart: true },
  { prefix: '######', label: '标题 6', body: '###### ${title}', lineStart: true },
  { prefix: 'h1', label: '标题 1', body: '# ${title}', lineStart: true },
  { prefix: 'h2', label: '标题 2', body: '## ${title}', lineStart: true },
  { prefix: 'h3', label: '标题 3', body: '### ${title}', lineStart: true },
  { prefix: 'h4', label: '标题 4', body: '#### ${title}', lineStart: true },

  // ========== 列表 ==========
  { prefix: 'ul', label: '无序列表', body: '- ${item}', lineStart: true },
  { prefix: 'ol', label: '有序列表', body: '1. ${item}', lineStart: true },
  { prefix: 'task', label: '待办项', body: '- [ ] ${task}', lineStart: true },
  { prefix: 'taskx', label: '已完成项', body: '- [x] ${task}', lineStart: true },
  { prefix: 'nul', label: '嵌套列表', body: '  - ${item}', lineStart: true },
  { prefix: 'li3', label: '三行列表', body: '- ${1:第一项}\n- ${2:第二项}\n- ${3:第三项}', lineStart: true },

  // ========== 表格 ==========
  {
    prefix: 'tbl', label: '表格 2×2', lineStart: true,
    body: '| ${1:列一} | ${2:列二} |\n| --- | --- |\n| ${3:内容} | ${4:内容} |',
  },
  {
    prefix: 'tbl3', label: '表格 3×3', lineStart: true,
    body: '| ${1:列一} | ${2:列二} | ${3:列三} |\n| --- | --- | --- |\n| ${4:} | ${5:} | ${6:} |\n| ${7:} | ${8:} | ${9:} |',
  },
  {
    prefix: 'tbl4', label: '表格 4×4', lineStart: true,
    body: '| ${1:列一} | ${2:列二} | ${3:列三} | ${4:列四} |\n| --- | --- | --- | --- |\n| ${5:} | ${6:} | ${7:} | ${8:} |\n| ${9:} | ${10:} | ${11:} | ${12:} |',
  },
  {
    prefix: 'tblalign', label: '表格 3 列对齐', lineStart: true,
    body: '| 左对齐 | 居中 | 右对齐 |\n| :--- | :---: | ---: |\n| ${1:} | ${2:} | ${3:} |',
  },
  {
    prefix: 'tbltask', label: '任务表格', lineStart: true,
    body: '| 任务 | 负责人 | 状态 |\n| --- | --- | --- |\n| ${1:任务} | ${2:负责人} | ${3|待办,进行中,已完成|} |',
  },

  // ========== 链接与图片 ==========
  { prefix: 'link', label: '链接', body: '[${text}](${url})' },
  { prefix: 'img', label: '图片', body: '![${alt}](${url})' },
  { prefix: 'ref', label: '引用式链接', body: '[${text}][${id}]\n\n[${id}]: ${url}' },
  { prefix: 'autolink', label: '自动链接', body: '<${url}>' },
  { prefix: 'maillink', label: '邮箱链接', body: '<${email}>' },

  // ========== 代码块 ==========
  { prefix: 'code', label: '代码块', body: '```${lang}\n${code}\n```', lineStart: true },
  { prefix: 'coderust', label: 'Rust 代码块', body: '```rust\n${code}\n```', lineStart: true },
  { prefix: 'codepy', label: 'Python 代码块', body: '```python\n${code}\n```', lineStart: true },
  { prefix: 'codejs', label: 'JavaScript 代码块', body: '```javascript\n${code}\n```', lineStart: true },
  { prefix: 'codets', label: 'TypeScript 代码块', body: '```typescript\n${code}\n```', lineStart: true },
  { prefix: 'codebash', label: 'Bash 代码块', body: '```bash\n${code}\n```', lineStart: true },
  { prefix: 'codejson', label: 'JSON 代码块', body: '```json\n${code}\n```', lineStart: true },
  { prefix: 'codehtml', label: 'HTML 代码块', body: '```html\n${code}\n```', lineStart: true },
  { prefix: 'codecss', label: 'CSS 代码块', body: '```css\n${code}\n```', lineStart: true },
  { prefix: 'codesql', label: 'SQL 代码块', body: '```sql\n${code}\n```', lineStart: true },
  { prefix: 'codeyaml', label: 'YAML 代码块', body: '```yaml\n${code}\n```', lineStart: true },
  { prefix: 'codego', label: 'Go 代码块', body: '```go\n${code}\n```', lineStart: true },
  { prefix: 'codejava', label: 'Java 代码块', body: '```java\n${code}\n```', lineStart: true },
  { prefix: 'codecpp', label: 'C++ 代码块', body: '```cpp\n${code}\n```', lineStart: true },

  // ========== 引用与 Callout ==========
  { prefix: 'quote', label: '引用', body: '> ${text}', lineStart: true },
  { prefix: 'quotem', label: '多行引用', body: '> ${1:第一行}\n> ${2:第二行}', lineStart: true },
  { prefix: 'callout', label: '提示块 Note', body: '> [!NOTE]\n> ${content}', lineStart: true },
  { prefix: 'note', label: '提示块 Note', body: '> [!NOTE]\n> ${content}', lineStart: true },
  { prefix: 'tip', label: '提示块 Tip', body: '> [!TIP]\n> ${content}', lineStart: true },
  { prefix: 'warn', label: '提示块 Warning', body: '> [!WARNING]\n> ${content}', lineStart: true },
  { prefix: 'caution', label: '提示块 Caution', body: '> [!CAUTION]\n> ${content}', lineStart: true },
  { prefix: 'imp', label: '提示块 Important', body: '> [!IMPORTANT]\n> ${content}', lineStart: true },

  // ========== 分割线 ==========
  { prefix: 'hr', label: '分割线', body: '---', lineStart: true },
  { prefix: 'hrstar', label: '星号分割线', body: '***', lineStart: true },

  // ========== 数学 ==========
  { prefix: 'math', label: '行内公式', body: '\\$${tex}\\$' },
  { prefix: 'mathd', label: '块级公式', body: '\\$\\$\n${tex}\n\\$\\$', lineStart: true },

  // ========== Mermaid ==========
  {
    prefix: 'mmdflow', label: 'Mermaid 流程图', lineStart: true,
    body: '```mermaid\ngraph TD\n    A[${1:开始}] --> B{${2:判断}}\n    B -->|是| C[${3:处理}]\n    B -->|否| D[${4:结束}]\n```',
  },
  {
    prefix: 'mmdseq', label: 'Mermaid 时序图', lineStart: true,
    body: '```mermaid\nsequenceDiagram\n    participant ${1:A}\n    participant ${2:B}\n    ${1:A}->>${2:B}: ${3:消息}\n    ${2:B}-->>${1:A}: ${4:响应}\n```',
  },
  {
    prefix: 'mmdclass', label: 'Mermaid 类图', lineStart: true,
    body: '```mermaid\nclassDiagram\n    class ${1:类名} {\n        +${2:属性}\n        +${3:方法}()\n    }\n```',
  },
  {
    prefix: 'mmdstate', label: 'Mermaid 状态图', lineStart: true,
    body: '```mermaid\nstateDiagram-v2\n    [*] --> ${1:状态A}\n    ${1:状态A} --> ${2:状态B} : ${3:事件}\n    ${2:状态B} --> [*]\n```',
  },
  {
    prefix: 'mmdpie', label: 'Mermaid 饼图', lineStart: true,
    body: '```mermaid\npie title ${1:标题}\n    "A" : ${2:30}\n    "B" : ${3:20}\n    "C" : ${4:50}\n```',
  },
  {
    prefix: 'mmdgantt', label: 'Mermaid 甘特图', lineStart: true,
    body: '```mermaid\ngantt\n    title ${1:项目计划}\n    dateFormat YYYY-MM-DD\n    section ${2:阶段一}\n    ${3:任务} :a1, 2026-01-01, 7d\n```',
  },
  {
    prefix: 'mmdmind', label: 'Mermaid 思维导图', lineStart: true,
    body: '```mermaid\nmindmap\n  root((${1:主题}))\n    ${2:分支一}\n      ${3:子项}\n    ${4:分支二}\n```',
  },
  {
    prefix: 'mmdtimeline', label: 'Mermaid 时间线', lineStart: true,
    body: '```mermaid\ntimeline\n    title ${1:时间线标题}\n    ${2:2026-01} : ${3:事件一}\n    ${4:2026-02} : ${5:事件二}\n```',
  },

  // ========== 扩展语法 ==========
  { prefix: 'bold', label: '加粗', body: '**${text}**' },
  { prefix: 'italic', label: '斜体', body: '*${text}*' },
  { prefix: 'strike', label: '删除线', body: '~~${text}~~' },
  { prefix: 'icode', label: '行内代码', body: '`${code}`' },
  { prefix: 'footnote', label: '脚注', body: '[^${id}]\n\n[^${id}]: ${text}' },
  { prefix: 'toc', label: '目录', body: '${1:# 目录}\n\n- [${2:章节一}](#${3:anchor-1})\n- [${4:章节二}](#${5:anchor-2})', lineStart: true },

  // ========== 中文场景模板 ==========
  {
    prefix: 'meeting', label: '会议纪要', lineStart: true,
    body: '# 会议纪要 · ${1:日期}\n\n## 参会人\n\n${2:参会人}\n\n## 议题与结论\n\n${3:议题与结论}\n\n## 待办\n\n- [ ] ${4:事项}（负责人：${5:姓名}）',
  },
  {
    prefix: 'weekly', label: '周报', lineStart: true,
    body: '## 本周进展\n\n- ${1:进展}\n\n## 数据\n\n${2:数据}\n\n## 下周计划\n\n- ${3:计划}\n\n## 风险与求助\n\n${4:风险}',
  },
  {
    prefix: 'todo', label: '今日待办', lineStart: true,
    body: '# 今日待办 · ${1:日期}\n\n## 重要且紧急\n\n- [ ] ${2:事项}\n\n## 重要不紧急\n\n- [ ] ${3:事项}\n\n## 其他\n\n- [ ] ${4:事项}',
  },
  {
    prefix: 'diary', label: '日记', lineStart: true,
    body: '# ${1:日期} 日记\n\n## 今日概况\n\n${2:概述}\n\n## 值得记录的事\n\n${3:事件}\n\n## 反思\n\n${4:反思}',
  },
  {
    prefix: 'reading', label: '读书笔记', lineStart: true,
    body: '# 《${1:书名}》读书笔记\n\n- 作者：${2:作者}\n- 阅读日期：${3:日期}\n\n## 核心观点\n\n${4:观点}\n\n## 摘录\n\n> ${5:摘录}\n\n## 我的思考\n\n${6:思考}',
  },
  {
    prefix: 'booknote', label: '书摘模板', lineStart: true,
    body: '> ${1:摘录原文}\n>\n> —— 《${2:书名}》\n\n${3:我的批注}',
  },
  {
    prefix: 'retro', label: '复盘模板', lineStart: true,
    body: '# ${1:项目}复盘 · ${2:日期}\n\n## 目标回顾\n\n${3:目标}\n\n## 结果评估\n\n${4:结果}\n\n## 原因分析\n\n${5:分析}\n\n## 经验教训\n\n${6:教训}\n\n## 下一步行动\n\n- [ ] ${7:行动}',
  },
  {
    prefix: 'okr', label: 'OKR 目标', lineStart: true,
    body: '# ${1:季度} OKR\n\n## Objective：${2:目标}\n\n### KR1：${3:关键结果}\n\n### KR2：${4:关键结果}\n\n### KR3：${5:关键结果}',
  },
  {
    prefix: 'fm', label: 'Frontmatter', lineStart: true,
    body: '---\ntitle: ${1:标题}\ndate: ${2:日期}\ntags: [${3:标签}]\n---\n',
  },
  {
    prefix: 'daily', label: '每日站会', lineStart: true,
    body: '## ${1:日期} 站会\n\n- 昨日完成：${2:事项}\n- 今日计划：${3:事项}\n- 阻碍与求助：${4:事项}',
  },
];

/** 合并用户片段：同 prefix 用户替换内置（删内置再 unshift，补全弹层不会出现两个同 prefix 条目），其余追加。 */
export function mergeUserSnippets(user: Snippet[]): void {
  if (!user.length) return;
  for (const u of user) {
    const i = SNIPPETS.findIndex((s) => s.prefix === u.prefix);
    if (i >= 0) SNIPPETS.splice(i, 1);
  }
  SNIPPETS.unshift(...user);
}
