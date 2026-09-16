// store 端到端校验：用内存 localStorage 桩驱动 zustand persist
import './setup-storage';
import { useWritingSystemStore } from '../src/store/useWritingSystemStore';
import { parseStrokeSet, reviewFingerprint } from '../src/utils/strokeOrder';
import { resolveStrokeOrder, strokeOrderKey } from '../src/utils/strokeOrderReview';
import { MOCK_RADICALS } from '../src/utils/mockData';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else { fail++; fails.push(msg); console.error('  ✗ ' + msg); }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const store = useWritingSystemStore;
const s = store.getState();
const radical = MOCK_RADICALS.find((r) => r.name === '日')!;
const set = parseStrokeSet(radical.baseShape);
const n = set.strokes.length;
ok(n > 1, '日字多笔');

// 1. 非法排列被拒绝
s.saveStrokeOrder(radical.id, null, [0, 0, 1], reviewFingerprint(set));
ok(!(strokeOrderKey(radical.id, null) in store.getState().strokeOrders), '重复索引排列被拒');
s.saveStrokeOrder(radical.id, null, set.order.slice(0, n - 1), reviewFingerprint(set));
ok(!(strokeOrderKey(radical.id, null) in store.getState().strokeOrders), '笔画数不足的排列被拒');
s.saveStrokeOrder(radical.id, null, set.order, reviewFingerprint(set) + 'x');
ok(!(strokeOrderKey(radical.id, null) in store.getState().strokeOrders), '指纹不符被拒');

// 2. 合法排列保存 → manual
const reversed = [...set.order].reverse();
s.saveStrokeOrder(radical.id, null, reversed, reviewFingerprint(set));
const saved = store.getState().strokeOrders[strokeOrderKey(radical.id, null)];
eq(saved.order, reversed, '合法手工顺序已保存');
const r1 = resolveStrokeOrder(store.getState().radicals.find((x) => x.id === radical.id)!, null, store.getState().strokeOrders);
eq(r1.status, 'manual', '状态 manual');
eq(r1.order, reversed, '生效顺序为手工顺序');

// 3. 字形一改（不动字根 id）→ stale
s.updateRadical(radical.id, { baseShape: radical.baseShape + ' M50 90 L50 96' });
const r2 = resolveStrokeOrder(store.getState().radicals.find((x) => x.id === radical.id)!, null, store.getState().strokeOrders);
eq(r2.status, 'stale', '字形变更后标为待复核');
eq(r2.order.length, n + 1, '规则顺序覆盖新笔画数，旧覆盖不再被采用');

// 4. 恢复字形后同指纹重新确认 → manual
s.updateRadical(radical.id, { baseShape: radical.baseShape });
const setAgain = parseStrokeSet(radical.baseShape);
s.saveStrokeOrder(radical.id, null, [...setAgain.order].reverse(), reviewFingerprint(setAgain));
eq(
  resolveStrokeOrder(store.getState().radicals.find((x) => x.id === radical.id)!, null, store.getState().strokeOrders).status,
  'manual',
  '复核保存后恢复 manual'
);

// 5. 阶段变体覆盖 + removeStage 联动清理
const stageId = radical.variants[0].stageId;
const vset = parseStrokeSet(radical.variants[0].svgPath);
s.saveStrokeOrder(radical.id, stageId, [...vset.order].reverse(), reviewFingerprint(vset));
ok(strokeOrderKey(radical.id, stageId) in store.getState().strokeOrders, '阶段手工顺序已保存');
s.removeStage(stageId);
ok(!(strokeOrderKey(radical.id, stageId) in store.getState().strokeOrders), '删除阶段时清理其笔顺覆盖');
ok(!(store.getState().radicals.find((x) => x.id === radical.id)!.variants.some((v) => v.stageId === stageId)), '变体随阶段删除');

// 6. 删除字根联动清理
s.saveStrokeOrder(radical.id, null, reversed, reviewFingerprint(set));
s.removeRadical(radical.id);
ok(!(strokeOrderKey(radical.id, null) in store.getState().strokeOrders), '删除字根时清理其笔顺覆盖');
ok(!store.getState().radicals.some((x) => x.id === radical.id), '字根已删除');

// 7. 导出/导入往返保留笔顺
const before = store.getState().strokeOrders;
const json = s.exportData();
ok(JSON.parse(json).strokeOrders !== undefined, '导出包含 strokeOrders');
s.resetAll();
eq(Object.keys(store.getState().strokeOrders).length, 0, '重置后无笔顺覆盖');
s.importData(json);
eq(store.getState().strokeOrders, before, '导入后笔顺覆盖还原');

// 8. 导入旧版数据（无 strokeOrders）→ 空表而不报错
const old = JSON.stringify({
  stages: store.getState().stages,
  radicals: store.getState().radicals,
  lexemes: store.getState().lexemes,
});
s.importData(old);
eq(store.getState().strokeOrders, {}, '旧版数据导入后笔顺表为空');

// 9. 脏覆盖数据被 sanitize
s.importData(JSON.stringify({
  stages: store.getState().stages,
  radicals: store.getState().radicals,
  lexemes: store.getState().lexemes,
  strokeOrders: { 'a:b': { order: 'nope', fingerprint: 1 }, 'c:d': { order: [0, 1], fingerprint: 'fp' } },
}));
eq(Object.keys(store.getState().strokeOrders), ['c:d'], '非法覆盖条目被过滤，合法条目保留');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
