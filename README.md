# 字象乾坤 · 虚构语言字形演化板

React + TypeScript + Vite 应用：管理虚构文字的字根、历史阶段变体、组合与词条。

## 页面

- **字形网格** `/glyphs`：字根浏览、筛选、详情
- **演化时间线** `/timeline`：各历史阶段的字形演变
- **笔顺台** `/stroke-order`：把字形按子笔画拆开，自动排定笔顺并逐笔回放
- **字根编辑** `/editor/radical`：绘制字根与各阶段变体
- **字根组合** `/composer`、**词条库** `/lexicon`

## 笔顺台

- 每个 SVG 子路径（`M…`）视为一笔，曲线折线化后计算起笔、收笔、方向（框/横/竖/斜/点）与包围关系。
- 自动排序规则（确定性，同输入同结果）：外框先于内部 → 框/横先于竖 → 上先于下 → 左先于右 → 并列按起笔位置，再同则按原始路径序。
- 创作者可对「某字根 × 某阶段」手工调整顺序；只存一个 `0..n-1` 的排列，形状、笔画数、闭合状态都不变，保存时按当前形状二次校验。
- 规则版本上调或字形改变后，旧顺序自动标为「待复核」，左侧面板列出所有受影响字形。
- 空字形、单笔、起笔重合、非法路径（缺参数、无 M、空段等）都有明确状态与提示。
- 数据通过 zustand persist 持久化（键 `fictional-writing-system-v1`），旧存档自动兼容。

## 脚本

```bash
npm run dev        # 开发
npm run build      # 类型检查 + 生产构建
npm run lint       # ESLint
npm run verify     # 笔顺引擎 + store + 页面冒烟
```

---

## Vite 模板说明

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
