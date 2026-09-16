// 页面级冒烟：在 Node 中用 react-dom/server 渲染全部既有页面 + 笔顺台，
// 确保组件树在模拟数据下不抛错、主要文案在场。
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GlyphGridPage } from '../src/pages/GlyphGridPage';
import { TimelinePage } from '../src/pages/TimelinePage';
import { RadicalEditorPage } from '../src/pages/RadicalEditorPage';
import { ComposerPage } from '../src/pages/ComposerPage';
import { LexiconPage } from '../src/pages/LexiconPage';
import { StrokeOrderPage } from '../src/pages/StrokeOrderPage';

let pass = 0;
let fail = 0;
const fails: string[] = [];

function smoke(name: string, entry: string, routePath: string, node: React.ReactNode, mustContain: string[]) {
  try {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={routePath} element={node} />
        </Routes>
      </MemoryRouter>
    );
    for (const text of mustContain) {
      if (!html.includes(text)) {
        throw new Error(`渲染结果缺少文案：${text}`);
      }
    }
    pass++;
    console.log(`  ✓ ${name}（${html.length} 字符）`);
  } catch (e) {
    fail++;
    fails.push(`${name}: ${(e as Error).message}`);
    console.error(`  ✗ ${name}: ${(e as Error).message}`);
  }
}

smoke('字形网格', '/glyphs', '/glyphs', <GlyphGridPage />, ['字形库']);
smoke('演化时间线', '/timeline', '/timeline', <TimelinePage />, []);
smoke('字根编辑', '/editor/radical', '/editor/radical', <RadicalEditorPage />, ['创建新字根']);
smoke('字根组合', '/composer', '/composer', <ComposerPage />, []);
smoke('词条库', '/lexicon', '/lexicon', <LexiconPage />, []);
smoke('笔顺台（默认字根）', '/stroke-order', '/stroke-order', <StrokeOrderPage />, ['笔顺台', '笔画明细', '第']);
smoke('笔顺台（指定 日）', '/stroke-order?radical=rad-sun', '/stroke-order', <StrokeOrderPage />, ['笔顺台']);
smoke('笔顺台（指定 田/阶段）', '/stroke-order?radical=rad-field&stage=stage-4', '/stroke-order', <StrokeOrderPage />, ['笔顺台', '墨韵楷书']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
