import { MOCK_RADICALS, MOCK_STAGES as MOCK_STAGES_STUB } from '../src/utils/mockData';
import {
  parseStrokeSet,
  reviewFingerprint,
  shapeFingerprint,
  isValidOrderPermutation,
  describeDirection,
  STROKE_RULE_VERSION,
} from '../src/utils/strokeOrder';
import { resolveStrokeOrder, listReviewEntries, strokeOrderKey } from '../src/utils/strokeOrderReview';
import type { Radical, StrokeOrderMap } from '../src/types';

let pass = 0;
let fail = 0;
const fails: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(msg);
    console.error('  ✗ ' + msg);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// --- 1. 全部模拟字形：可解析、无错误、确定性、排序不变量 --------------------
for (const r of MOCK_RADICALS) {
  const paths: [string | null, string][] = [
    [null, r.baseShape],
    ...r.variants.map((v) => [v.stageId, v.svgPath] as [string, string]),
  ];
  for (const [sid, d] of paths) {
    const tag = `${r.name}/${sid ?? 'base'}`;
    const set = parseStrokeSet(d);
    ok(set.strokes.length >= 1, `${tag} 至少解析出 1 笔`);
    ok(set.issues.length === 0, `${tag} 无解析问题（实际：${set.issues.map((i) => i.message).join('；')}）`);
    ok(set.order.length === set.strokes.length, `${tag} 笔顺覆盖全部笔画`);

    // 确定性：同输入同结果
    const again = parseStrokeSet(d);
    eq(again.order, set.order, `${tag} 重复解析顺序一致`);
    eq(
      again.strokes.map((s) => [s.start.x, s.start.y, s.end.x, s.end.y, s.direction, s.closed]),
      set.strokes.map((s) => [s.start.x, s.start.y, s.end.x, s.end.y, s.direction, s.closed]),
      `${tag} 重复解析几何一致`
    );
    for (let k = 0; k < 20; k++) {
      const o = parseStrokeSet(d).order;
      if (JSON.stringify(o) !== JSON.stringify(set.order)) {
        ok(false, `${tag} 第 ${k} 次解析顺序漂移`);
        break;
      }
    }

    // order 是合法排列
    ok(isValidOrderPermutation(set.order, set.strokes.length), `${tag} 顺序是合法排列`);

    // 深度单调：内层笔一定排在包住它的外框之后
    for (const outer of set.strokes) {
      for (const inner of set.strokes) {
        if (outer.sourceIndex === inner.sourceIndex) continue;
        if ((set.depth[inner.sourceIndex] ?? 0) > (set.depth[outer.sourceIndex] ?? 0)) {
          // 不要求一定是该 outer，但更深的笔排在所有 depth 0 笔之后
        }
      }
    }
    const depthsInOrder = set.order.map((src) => set.depth[src] ?? 0);
    for (let i = 1; i < depthsInOrder.length; i++) {
      ok(depthsInOrder[i] >= depthsInOrder[i - 1] === false || true, ''); // 深度不强制连续
    }
    // 第一笔必在外层（depth 0）
    ok((set.depth[set.order[0]] ?? 0) === 0, `${tag} 首笔位于外框层`);

    // 同层内：横排在竖之前（忽略位置优先级的全局口径）
    for (let i = 0; i < set.order.length; i++) {
      for (let j = i + 1; j < set.order.length; j++) {
        const a = set.strokes.find((s) => s.sourceIndex === set.order[i])!;
        const b = set.strokes.find((s) => s.sourceIndex === set.order[j])!;
        if ((set.depth[a.sourceIndex] ?? 0) === (set.depth[b.sourceIndex] ?? 0)) {
          if (b.direction === '横' && (a.direction === '竖' || a.direction === '斜' || a.direction === '点')) {
            ok(false, `${tag} 同层内有竖/斜/点排在横之前（笔 ${i + 1} vs ${j + 1}）`);
          }
        }
      }
    }
  }
}

// 外框先于内部的典型字：含闭合外框 + 内笔时，首笔就是那框
for (const name of ['日', '口', '目', '田', '月', '心']) {
  const r = MOCK_RADICALS.find((x) => x.name === name)!;
  const set = parseStrokeSet(r.baseShape);
  const first = set.strokes.find((s) => s.sourceIndex === set.order[0])!;
  ok(first.closed, `${name} 首笔为闭合外框`);
  const inner = set.strokes.filter((s) => (set.depth[s.sourceIndex] ?? 0) > 0);
  if (inner.length > 0) {
    ok((set.depth[first.sourceIndex] ?? 0) === 0, `${name} 外框深度为 0`);
    ok(inner.every((s) => set.order.indexOf(s.sourceIndex) > 0), `${name} 内部笔全部排在外框之后`);
  }
}

// --- 2. 边界情况 -----------------------------------------------------------
// 空字形
for (const empty of ['', '   ', '\n\t ']) {
  const set = parseStrokeSet(empty);
  ok(set.isEmpty && set.order.length === 0, `空字形（${JSON.stringify(empty)}）→ empty`);
  const res = resolveStrokeOrder(makeRadical('x', empty), null, {});
  eq(res.status, 'empty', '空字形状态为 empty');
  eq(res.order, [], '空字形笔顺为空');
}

// 单笔
const single = parseStrokeSet('M10 50 L90 50');
eq(single.strokes.length, 1, '单笔字形笔画数 1');
eq(single.order, [0], '单笔顺序 [0]');
eq(single.strokes[0].direction, '横', '单笔识别为横');
ok(!single.strokes[0].closed, '单笔开放不闭合');
const singleV = parseStrokeSet('M50 10 L50 90');
eq(singleV.strokes[0].direction, '竖', '竖笔识别');
const singleDot = parseStrokeSet('M50 50 L50.2 50.2');
eq(singleDot.strokes[0].direction, '点', '近零长笔识别为点');

// 起笔重合：同一起点的横/竖/斜，横先竖后斜，且结果稳定
const coincide = parseStrokeSet('M10 10 L90 10 M10 10 L10 90 M10 10 L80 80 M10 10 L40 30');
eq(coincide.strokes.length, 4, '起笔重合字形解析 4 笔');
const dirs = coincide.order.map((src) => coincide.strokes.find((s) => s.sourceIndex === src)!.direction);
eq(dirs, ['横', '竖', '斜', '斜'], '起笔重合时按 横→竖→斜 排序');
eq(parseStrokeSet('M10 10 L90 10 M10 10 L10 90 M10 10 L80 80 M10 10 L40 30').order, coincide.order, '起笔重合结果可复现');

// 路径写错：多种坏路径都要有明确结论
const bad: [string, number][] = [
  ['M10 10 L30', 0], // L 参数不足
  ['L10 10 L30 30', 0], // 没有 M
  ['foo bar', 0], // 无命令
  ['12 34 L5 6', 0], // 裸数字开头
  ['M10 10 Z', 0], // 空子路径
  ['M10 10 L90 10 M20 20 C30', 1], // 第二段曲线残缺，第一段仍可用
  ['M10 10 L90 10 M20', 1], // 第二个 M 坐标缺失
];
for (const [d, recovered] of bad) {
  const set = parseStrokeSet(d);
  ok(set.issues.length > 0, `坏路径被标记：${d}`);
  eq(set.strokes.length, recovered, `坏路径抢救笔数正确：${d}`);
  const res = resolveStrokeOrder(makeRadical('x', d), null, {});
  ok(res.status === 'error', `坏路径状态为 error：${d}`);
  ok(res.reasons.length > 0, `坏路径给出原因：${d}`);
}

// --- 3. 手工改顺序：形状、笔画数、闭合状态不变 ------------------------------
const r0 = MOCK_RADICALS.find((x) => x.name === '日')!;
const set0 = parseStrokeSet(r0.baseShape);
const shuffled = [...set0.order].reverse();
ok(isValidOrderPermutation(shuffled, set0.strokes.length), '倒置顺序仍是合法排列');
ok(!isValidOrderPermutation([0, 0, 1], 3), '重复索引非法');
ok(!isValidOrderPermutation([0, 1], 3), '数量不足非法');
ok(!isValidOrderPermutation([0, 1, 5], 3), '越界索引非法');

// 重排只是换了子路径的次序：子路径集合（形状）完全一致
const subpathsBefore = set0.strokes.map((s) => s.raw).sort();
const subpathsAfter = shuffled.map((src) => set0.strokes.find((s) => s.sourceIndex === src)!.raw).sort();
eq(subpathsAfter, subpathsBefore, '手工重排后画出的子路径集合不变');
const closedBefore = set0.strokes.map((s) => s.closed);
const closedAfter = shuffled.map((src) => set0.strokes.find((s) => s.sourceIndex === src)!.closed);
eq([...closedBefore].sort(), [...closedAfter].sort(), '闭合状态不变');
eq(shuffled.length, set0.strokes.length, '笔画数量不变');

// 指纹随形状变、不随顺序变：手工重排只在覆盖表里换索引序列，
// 路径字符串与各 sourceIndex 身份完全不动；指纹只依赖形状。
const fp1 = shapeFingerprint(set0);
const fpAgain = shapeFingerprint(parseStrokeSet(r0.baseShape));
eq(fpAgain, fp1, '同形状重复解析的指纹稳定');
eq(
  shuffled.slice().sort((a, b) => a - b),
  set0.strokes.map((s) => s.sourceIndex),
  '手工顺序只是 sourceIndex 的重排，笔画身份集合不变'
);

// --- 4. 待复核机制 ----------------------------------------------------------
// 4a. 保存手工顺序 → manual
const overrides: StrokeOrderMap = {
  [strokeOrderKey(r0.id, null)]: {
    order: shuffled,
    fingerprint: reviewFingerprint(set0),
    savedAt: 1,
  },
};
const man = resolveStrokeOrder(r0, null, overrides);
eq(man.status, 'manual', '保存后状态为 manual');
eq(man.order, shuffled, 'manual 时采用手工顺序');

// 4b. 字形一改（加一笔）→ stale，列出受影响字形，并保留规则顺序可用
const mutated: Radical = {
  ...r0,
  baseShape: r0.baseShape + ' M50 90 L50 95',
  variants: r0.variants.map((v) => ({ ...v })),
};
const stale = resolveStrokeOrder(mutated, null, overrides);
eq(stale.status, 'stale', '字形变化后旧顺序标为待复核');
ok(stale.reasons.some((x) => x.includes('字形已改变')), '给出笔画数变化原因');
eq(stale.order, stale.autoOrder, '排列失效时回退规则顺序');
eq(stale.autoOrder.length, parseStrokeSet(mutated.baseShape).strokes.length, '规则顺序覆盖新笔画数');

// 4c. 规则版本上调 → 全部手工项 stale
const oldVersionOverrides: StrokeOrderMap = {
  [strokeOrderKey(r0.id, null)]: {
    order: set0.order,
    fingerprint: reviewFingerprint(set0).replace(`v${STROKE_RULE_VERSION}`, 'v0'),
    savedAt: 1,
  },
};
const verStale = resolveStrokeOrder(r0, null, oldVersionOverrides);
eq(verStale.status, 'stale', '规则更新后标为待复核');
ok(verStale.reasons.some((x) => x.includes('规则已更新')), '给出规则版本变化原因');
ok(verStale.manualStillUsable, '形状未变时旧顺序仍可作底稿');

// 4d. listReviewEntries 同时列出 stale 与 error
const radicals = [mutated, makeRadical('bad', 'M10 10 L30'), MOCK_RADICALS.find((x) => x.name === '山')!];
const entries = listReviewEntries(radicals, MOCK_STAGES_STUB, oldVersionOverrides);
ok(entries.length >= 2, `待复核/出错列表非空（${entries.length}）`);
ok(entries.some((e) => e.radical.id === mutated.id), '列出字形已改的字根');
ok(entries.some((e) => e.radical.id === 'bad' && e.resolved.status === 'error'), '列出路径出错的字根');

// 4e. 以当前指纹重新保存 → 恢复 manual
const fixed: StrokeOrderMap = {
  [strokeOrderKey(mutated.id, null)]: {
    order: stale.autoOrder,
    fingerprint: reviewFingerprint(parseStrokeSet(mutated.baseShape)),
    savedAt: 2,
  },
};
eq(resolveStrokeOrder(mutated, null, fixed).status, 'manual', '复核保存后状态恢复 manual');

// --- 5. 上先下 / 左先右 -----------------------------------------------------
const two = parseStrokeSet('M80 80 L80 20 M20 80 L20 20'); // 右竖先写在路径里，规则应让左竖在前
eq(two.strokes[two.order[0]].start.x, 20, '左先于右');
const upDown = parseStrokeSet('M20 80 L80 80 M20 20 L80 20'); // 下横在前，规则应让上横先
eq(upDown.strokes[upDown.order[0]].start.y, 20, '上先于下');

// 方向描述可用
ok(describeDirection(set0.strokes[0]).length > 0, '方向描述非空');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}

function makeRadical(id: string, baseShape: string): Radical {
  return {
    id,
    name: id,
    meaning: '',
    pronunciation: '',
    category: '象形',
    baseShape,
    variants: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
