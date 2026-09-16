/**
 * 笔顺引擎
 * --------
 * 把一条字形（SVG path，viewBox 0 0 100 100，子路径以 M 起笔）拆成「子笔画」，
 * 算出每笔的起点、终点、方向与包围关系，再按固定规则给出唯一的书写顺序。
 *
 * 规则（按优先级）：
 *   1. 外框先于内部（被别的闭合笔画框住的笔画后写；外框自身先写）
 *   2. 横先于竖（同一框层内）
 *   3. 上先于下（起笔 y 小者先）
 *   4. 左先于右（起笔 x 小者先）
 *   5. 并列时按起笔位置排定（先上后下、先左后右），仍相同则按原始路径序
 *
 * 所有判定均为纯函数：同一输入必然得到同一结果，不依赖时间、随机数。
 */

/** 规则版本：规则或解析口径调整时 +1，会令全部已存手工顺序进入待复核。 */
export const STROKE_RULE_VERSION = 1;

/** 几何容差（viewBox 单位），起笔重合、长度去重用。 */
const EPS = 0.5;

export type StrokeDirection =
  | '框' // 闭合且有面积的外框笔（矩形、圆、轮廓），同层最先
  | '横' // 主导方向水平：|dx| 明显大于 |dy|
  | '竖' // 主导方向垂直：|dy| 明显大于 |dx|
  | '斜' // 横、竖之外（撇捺曲线等）
  | '点'; // 起终点几乎重合的短笔（点、点痕）

export type ParseErrorKind =
  | 'empty' // 空字形：路径为空 / 只有空白
  | 'no-command' // 路径写错：找不到任何绘制命令
  | 'bad-number' // 路径写错：命令后数字残缺或非法
  | 'no-moveto' // 路径写错：绘制命令出现在任何 M 之前
  | 'unclosed-curve' // 路径写错：曲线参数不足
  | 'empty-subpath'; // 路径写错：M 之后没有任何绘制段（如 "M10 10 Z"）

export interface ParseIssue {
  kind: ParseErrorKind;
  /** 面向创作者的说明 */
  message: string;
  /** 解析器仍能抢救出来的子笔画数（0 表示整字不可用） */
  recoveredStrokes: number;
}

export interface Stroke {
  /** 在原始路径中的子路径序号（0 起），也是「形状不变」的身份 */
  sourceIndex: number;
  /** 原始子路径串（规范化后），渲染时直接用 */
  raw: string;
  /** 折线化后的采样点（含曲线 flatten），至少两个点 */
  points: Point[];
  start: Point;
  end: Point;
  /** 路径自身是否闭合（含 Z/z 或起终点闭合） */
  closed: boolean;
  direction: StrokeDirection;
  /** 折线近似长度 */
  length: number;
  bbox: BBox;
  /** 质心（采样点均值），用于内/外判定 */
  centroid: Point;
}

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokeSet {
  strokes: Stroke[];
  /** 排序后的 sourceIndex 序列，即笔顺 */
  order: number[];
  /** 每笔的框层深度：0 = 外框层，越大越靠内 */
  depth: Record<number, number>;
  /** 空字形（无错误但没有笔画） */
  isEmpty: boolean;
  /** 路径写错时的问题列表；非空表示该字形需要回编辑器修正 */
  issues: ParseIssue[];
}

// ---------------------------------------------------------------------------
// Path 解析
// ---------------------------------------------------------------------------

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/**
 * 把路径切成「命令 + 数字参数」的 token 流，严格校验。
 * 任何非法情况都记录 issue，并尽量继续解析后续部分。
 */
type Token = { cmd: string; args: number[] };

function tokenizePath(d: string): { tokens: Token[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const tokens: Token[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])/g;
  const ARG_COUNT: Record<string, number> = {
    M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
    C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, A: 7, a: 7,
    Z: 0, z: 0,
  };

  let cursor = 0;
  let match: RegExpExecArray | null;
  let seenCommand = false;

  // 命令出现之前的裸数字 → no-command / bad-number
  const firstCmd = d.search(/[MmLlHhVvCcSsQqTtAaZz]/);
  const leading = firstCmd === -1 ? d : d.slice(0, firstCmd);
  if (/\S/.test(leading)) {
    NUMBER_RE.lastIndex = 0;
    if (NUMBER_RE.test(leading)) {
      issues.push(mkIssue('no-command', '路径以数字开头，缺少起笔命令 M。'));
    } else {
      issues.push(mkIssue('bad-number', `路径开头存在无法识别的字符：「${leading.trim().slice(0, 12)}」。`));
    }
  }

  while ((match = re.exec(d)) !== null) {
    seenCommand = true;
    const cmd = match[1];
    const between = d.slice(cursor, match.index);
    // 两个命令之间若夹着无法识别的非空白内容（通常是畸形数字）
    const stray = between.replace(NUMBER_RE, '').replace(/[,\s]/g, '');
    if (stray.trim() !== '') {
      issues.push(mkIssue('bad-number', `命令 ${cmd} 之前存在无法识别的字符：「${stray.trim().slice(0, 12)}」。`));
    }
    cursor = re.lastIndex;

    const n = ARG_COUNT[cmd];
    if (n === 0) {
      tokens.push({ cmd, args: [] });
      continue;
    }

    // 取出本命令到下一命令之间的全部数字
    const nextCmd = d.slice(cursor).search(/[MmLlHhVvCcSsQqTtAaZz]/);
    const argText = nextCmd === -1 ? d.slice(cursor) : d.slice(cursor, cursor + nextCmd);
    const nums: number[] = [];
    let nm: RegExpExecArray | null;
    NUMBER_RE.lastIndex = 0;
    while ((nm = NUMBER_RE.exec(argText)) !== null) {
      const v = Number(nm[0]);
      if (!Number.isFinite(v)) {
        issues.push(mkIssue('bad-number', `命令 ${cmd} 含非法数字「${nm[0]}」。`));
        continue;
      }
      nums.push(v);
    }

    if (nums.length < n) {
      const isCurve = 'CcSsQqTt'.includes(cmd);
      issues.push(
        mkIssue(
          isCurve ? 'unclosed-curve' : 'bad-number',
          `命令 ${cmd} 需要 ${n} 个参数，实际只有 ${nums.length} 个，已忽略残缺段。`
        )
      );
      // 参数不足的命令整段丢弃，避免污染几何
      continue;
    }

    if (cmd === 'M' || cmd === 'm') {
      // M 可隐式重复：多余的坐标对等价于 L / l
      const pairs = Math.floor(nums.length / 2);
      tokens.push({ cmd, args: nums.slice(0, 2) });
      for (let i = 1; i < pairs; i++) {
        tokens.push({ cmd: cmd === 'M' ? 'L' : 'l', args: nums.slice(i * 2, i * 2 + 2) });
      }
      if (nums.length % 2 === 1) {
        issues.push(mkIssue('bad-number', `命令 ${cmd} 坐标不成对，末尾多出一个数字，已忽略。`));
      }
    } else {
      // 支持同类命令的隐式重复（参数成组）
      const groups = Math.floor(nums.length / n);
      for (let i = 0; i < groups; i++) {
        tokens.push({ cmd, args: nums.slice(i * n, (i + 1) * n) });
      }
      if (nums.length % n !== 0) {
        issues.push(mkIssue('bad-number', `命令 ${cmd} 末尾参数不足一组，已忽略 ${nums.length % n} 个数字。`));
      }
    }
  }

  if (!seenCommand) {
    if (d.trim() === '') {
      issues.push(mkIssue('empty', '字形为空。'));
    } else {
      issues.push(mkIssue('no-command', '路径中没有任何绘制命令（M/L/C/Z…）。'));
    }
  }

  return { tokens, issues: dedupe(issues) };
}

function mkIssue(kind: ParseErrorKind, message: string, recoveredStrokes = 0): ParseIssue {
  return { kind, message, recoveredStrokes };
}

function dedupe(issues: ParseIssue[]): ParseIssue[] {
  const seen = new Set<string>();
  const out: ParseIssue[] = [];
  for (const i of issues) {
    const key = `${i.kind}:${i.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// token → 子笔画（折线化）
// ---------------------------------------------------------------------------

const FLAT_STEPS = 12;

function flattenTokens(tokens: Token[]): { strokes: Stroke[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const rawStrokes: Stroke[] = [];

  let cur: Point | null = null;
  let start: Point | null = null;
  let pts: Point[] = [];
  let rawParts: string[] = [];
  let closedByZ = false;
  let subIndex = 0;
  let drewSinceMove = false;

  const finishSub = () => {
    if (start === null) return;
    if (!drewSinceMove || pts.length < 2) {
      issues.push(mkIssue('empty-subpath', `第 ${subIndex + 1} 笔只有起笔点、没有行笔段，已跳过。`));
    } else {
      rawStrokes.push(buildStroke(subIndex, pts, closedByZ, rawParts.join(' ')));
    }
    subIndex += 1;
    pts = [];
    rawParts = [];
    drewSinceMove = false;
    closedByZ = false;
    start = null;
    cur = null;
  };

  // 上一条曲线控制点（用于 S/T 平滑续接）
  let prevCtrl: Point | null = null;
  let prevCmd = '';

  for (const t of tokens) {
    const { cmd, args: a } = t;
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;

    if (upper === 'M') {
      finishSub();
      const p = rel && cur ? { x: cur.x + a[0], y: cur.y + a[1] } : { x: a[0], y: a[1] };
      cur = p;
      start = p;
      pts = [p];
      rawParts = [`M${fmt(p.x)} ${fmt(p.y)}`];
      prevCtrl = null;
    } else if (upper === 'Z') {
      if (!cur || !start) {
        // 孤立的 Z：不属于任何子笔画，忽略
        prevCtrl = null;
        continue;
      }
      if (!pointEq(cur, start)) {
        pts.push({ ...start });
        cur = { ...start };
      }
      closedByZ = true;
      rawParts.push('Z');
      finishSub();
      prevCtrl = null;
    } else {
      if (!cur || !start) {
        // 行笔命令出现在任何 M 之前：由 token 流的统一检查记录问题，这里直接忽略
        continue;
      }
      drewSinceMove = true;

      switch (upper) {
        case 'L': {
          const p = rel ? { x: cur.x + a[0], y: cur.y + a[1] } : { x: a[0], y: a[1] };
          pts.push(p);
          rawParts.push(`L${fmt(p.x)} ${fmt(p.y)}`);
          cur = p;
          prevCtrl = null;
          break;
        }
        case 'H': {
          const p = { x: rel ? cur.x + a[0] : a[0], y: cur.y };
          pts.push(p);
          rawParts.push(`L${fmt(p.x)} ${fmt(p.y)}`);
          cur = p;
          prevCtrl = null;
          break;
        }
        case 'V': {
          const p = { x: cur.x, y: rel ? cur.y + a[0] : a[0] };
          pts.push(p);
          rawParts.push(`L${fmt(p.x)} ${fmt(p.y)}`);
          cur = p;
          prevCtrl = null;
          break;
        }
        case 'C': {
          const p0 = cur;
          const c1 = rel ? { x: p0.x + a[0], y: p0.y + a[1] } : { x: a[0], y: a[1] };
          const c2 = rel ? { x: p0.x + a[2], y: p0.y + a[3] } : { x: a[2], y: a[3] };
          const p1 = rel ? { x: p0.x + a[4], y: p0.y + a[5] } : { x: a[4], y: a[5] };
          appendCubic(pts, p0, c1, c2, p1);
          rawParts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`);
          cur = p1;
          prevCtrl = c2;
          break;
        }
        case 'S': {
          const p0 = cur;
          const c1 =
            prevCtrl && (prevCmd === 'C' || prevCmd === 'S')
              ? { x: 2 * p0.x - prevCtrl.x, y: 2 * p0.y - prevCtrl.y }
              : { ...p0 };
          const c2 = rel ? { x: p0.x + a[0], y: p0.y + a[1] } : { x: a[0], y: a[1] };
          const p1 = rel ? { x: p0.x + a[2], y: p0.y + a[3] } : { x: a[2], y: a[3] };
          appendCubic(pts, p0, c1, c2, p1);
          rawParts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`);
          cur = p1;
          prevCtrl = c2;
          break;
        }
        case 'Q': {
          const p0 = cur;
          const c = rel ? { x: p0.x + a[0], y: p0.y + a[1] } : { x: a[0], y: a[1] };
          const p1 = rel ? { x: p0.x + a[2], y: p0.y + a[3] } : { x: a[2], y: a[3] };
          appendQuad(pts, p0, c, p1);
          rawParts.push(`Q${fmt(c.x)} ${fmt(c.y)} ${fmt(p1.x)} ${fmt(p1.y)}`);
          cur = p1;
          prevCtrl = c;
          break;
        }
        case 'T': {
          const p0 = cur;
          const c =
            prevCtrl && (prevCmd === 'Q' || prevCmd === 'T')
              ? { x: 2 * p0.x - prevCtrl.x, y: 2 * p0.y - prevCtrl.y }
              : { ...p0 };
          const p1 = rel ? { x: p0.x + a[0], y: p0.y + a[1] } : { x: a[0], y: a[1] };
          appendQuad(pts, p0, c, p1);
          rawParts.push(`Q${fmt(c.x)} ${fmt(c.y)} ${fmt(p1.x)} ${fmt(p1.y)}`);
          cur = p1;
          prevCtrl = c;
          break;
        }
        case 'A': {
          // 几何上按弦线近似（仅用于起终点与内外判定）；
          // 原始 A 命令原样保留，回放渲染的仍是弧形，形状不变。
          const p1 = rel ? { x: cur.x + a[5], y: cur.y + a[6] } : { x: a[5], y: a[6] };
          pts.push(p1);
          rawParts.push(
            `A${fmt(a[0])} ${fmt(a[1])} ${fmt(a[2])} ${a[3]} ${a[4]} ${fmt(p1.x)} ${fmt(p1.y)}`
          );
          cur = p1;
          prevCtrl = null;
          break;
        }
      }
      prevCmd = upper;
    }
  }
  finishSub();

  return { strokes: rawStrokes, issues };
}

function appendCubic(pts: Point[], p0: Point, c1: Point, c2: Point, p1: Point) {
  for (let i = 1; i <= FLAT_STEPS; i++) {
    const t = i / FLAT_STEPS;
    const mt = 1 - t;
    pts.push({
      x: mt ** 3 * p0.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p1.x,
      y: mt ** 3 * p0.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p1.y,
    });
  }
}

function appendQuad(pts: Point[], p0: Point, c: Point, p1: Point) {
  for (let i = 1; i <= FLAT_STEPS; i++) {
    const t = i / FLAT_STEPS;
    const mt = 1 - t;
    pts.push({
      x: mt ** 2 * p0.x + 2 * mt * t * c.x + t ** 2 * p1.x,
      y: mt ** 2 * p0.y + 2 * mt * t * c.y + t ** 2 * p1.y,
    });
  }
}

// ---------------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------------

function buildStroke(sourceIndex: number, rawPoints: Point[], closedByZ: boolean, raw: string): Stroke {
  // 去掉连续重复点
  const points: Point[] = [];
  for (const p of rawPoints) {
    const last = points[points.length - 1];
    if (!last || !pointEq(p, last)) points.push(p);
  }
  if (points.length < 2 && rawPoints.length >= 2) {
    points.push(rawPoints[rawPoints.length - 1]);
    if (points.length < 2) points.unshift(rawPoints[0]);
  }

  const start = points[0];
  const end = points[points.length - 1];
  const closedAuto = !closedByZ && pointEq(start, end);
  const closed = closedByZ || closedAuto;

  let length = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sx = 0, sy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) length += dist(points[i - 1], p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    sx += p.x;
    sy += p.y;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let direction: StrokeDirection;
  if (closed && polygonArea(points) >= 4) {
    // 闭合且有面积 → 外框笔；不能只看起终点（闭合框起终点重合会被误判成点）
    direction = '框';
  } else if (length < EPS || (Math.abs(dx) < EPS && Math.abs(dy) < EPS)) {
    direction = '点';
  } else if (Math.abs(dx) > Math.abs(dy) * 1.7) {
    direction = '横';
  } else if (Math.abs(dy) > Math.abs(dx) * 1.7) {
    direction = '竖';
  } else {
    direction = '斜';
  }

  return {
    sourceIndex,
    raw,
    points,
    start,
    end,
    closed,
    direction,
    length,
    bbox: { minX, minY, maxX, maxY },
    centroid: { x: sx / points.length, y: sy / points.length },
  };
}

function polygonArea(p: Point[]): number {
  if (p.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}

const pointEq = (a: Point, b: Point) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** 点是否在闭合笔画内部（射线法，落在边界上按容差视为在内）。 */
function pointInsideStroke(p: Point, s: Stroke): boolean {
  if (!s.closed || s.points.length < 3) return false;
  const poly = s.points;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    // 边界容差
    if (distToSegment(p, poly[j], poly[i]) <= 0.6) return true;
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// ---------------------------------------------------------------------------
// 框层深度与排序
// ---------------------------------------------------------------------------

/**
 * 计算每笔的框层：
 *   闭合笔画 C 若「实质包住」另一笔（起笔、质心、多数采样点都在其内，
 *   且自身面积明显更大），则被包者深度 +1。
 * 互相包套（同心圆/回字形）时深度按嵌套层数递增。
 */
function computeDepths(strokes: Stroke[]): Record<number, number> {
  const depth: Record<number, number> = {};
  strokes.forEach((s) => (depth[s.sourceIndex] = 0));

  const encloses = (outer: Stroke, inner: Stroke): boolean => {
    if (!outer.closed || outer.sourceIndex === inner.sourceIndex) return false;
    if (polygonArea(outer.points) < 4) return false;
    if (!pointInsideStroke(inner.start, outer)) return false;
    if (!pointInsideStroke(inner.centroid, outer)) return false;
    let insideCount = 0;
    const step = Math.max(1, Math.floor(inner.points.length / 12));
    let sampled = 0;
    for (let i = 0; i < inner.points.length; i += step) {
      sampled += 1;
      if (pointInsideStroke(inner.points[i], outer)) insideCount += 1;
    }
    return insideCount / sampled >= 0.8;
  };

  // 迭代传播：若 outer 包住 inner，inner 的深度至少 = outer 深度 + 1
  // 用多轮松弛处理多层嵌套与交叉引用；轮数有上界保证收敛。
  for (let round = 0; round < strokes.length + 1; round++) {
    let changed = false;
    for (const outer of strokes) {
      for (const inner of strokes) {
        if (encloses(outer, inner)) {
          const want = depth[outer.sourceIndex] + 1;
          if (want > depth[inner.sourceIndex]) {
            depth[inner.sourceIndex] = want;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return depth;
}

/** 单个笔画的规则序值；数组逐项比较，天然确定性。 */
function rankStroke(s: Stroke, depth: Record<number, number>): number[] {
  const dirRank =
    s.direction === '框'
      ? 0 // 外框笔在同层最先
      : s.direction === '横'
        ? 1 // 横先于竖
        : s.direction === '竖'
          ? 2
          : s.direction === '点'
            ? 3
            : 4; // 斜
  return [
    depth[s.sourceIndex] ?? 0, // 1. 外框先于内部（被包住的笔深度更大）
    dirRank, // 2. 框 → 横 → 竖（斜、点居后，同层内再按起笔位置处理）
    bucket(s.start.y), // 3. 上先于下（按 4 单位行带，避免毫米级抖动误判并列）
    bucket(s.start.x), // 4. 左先于右
    s.sourceIndex, // 5. 并列：起笔位置仍相同 → 原始路径序，保证全序确定
  ];
}

const BUCKET = 4;
const bucket = (v: number) => Math.round(v / BUCKET);

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 对外主入口
// ---------------------------------------------------------------------------

export function parseStrokeSet(svgPath: string): StrokeSet {
  if (svgPath.trim() === '') {
    return {
      strokes: [],
      order: [],
      depth: {},
      isEmpty: true,
      issues: [mkIssue('empty', '空字形：还没有任何笔画。')],
    };
  }

  const { tokens, issues: tokenIssues } = tokenizePath(svgPath);

  // 绘制命令出现在第一个 M 之前
  const hasFatalNoMove = tokenIssues.some((i) => i.kind === 'no-command');
  const firstDrawBeforeMove = (() => {
    let seenMove = false;
    for (const t of tokens) {
      if (t.cmd === 'M' || t.cmd === 'm') seenMove = true;
      else if (!seenMove) return true;
    }
    return false;
  })();
  if (firstDrawBeforeMove && !hasFatalNoMove) {
    tokenIssues.push(mkIssue('no-moveto', '行笔命令出现在起笔 M 之前，已忽略前置段。'));
  }

  const { strokes, issues: flatIssues } = flattenTokens(tokens);
  const allIssues = dedupe([...tokenIssues, ...flatIssues]);

  const depth = computeDepths(strokes);
  const ranks = new Map<number, number[]>();
  strokes.forEach((s) => ranks.set(s.sourceIndex, rankStroke(s, depth)));

  const order = strokes
    .map((s) => s.sourceIndex)
    .sort((i1, i2) => compareRank(ranks.get(i1)!, ranks.get(i2)!));

  const recovered = strokes.length;
  const issues = allIssues.map((i) => ({ ...i, recoveredStrokes: recovered }));

  return { strokes, order, depth, isEmpty: false, issues };
}

/** 取第 n 笔（笔顺序号 0 起）对应的笔画。 */
export function strokeAtOrder(set: StrokeSet, orderIndex: number): Stroke | undefined {
  const src = set.order[orderIndex];
  return set.strokes.find((s) => s.sourceIndex === src);
}

/** 方向的中文描述（用于台面展示）。 */
export function describeDirection(s: Stroke): string {
  if (s.direction === '框') {
    return '框 ▣（闭合外框）';
  }
  const dx = Math.round(s.end.x - s.start.x);
  const dy = Math.round(s.end.y - s.start.y);
  const arrow =
    s.direction === '点'
      ? '·'
      : Math.abs(dx) + Math.abs(dy) === 0
        ? '·'
        : dy > 0 && Math.abs(dy) >= Math.abs(dx)
          ? '↓'
          : dy < 0 && Math.abs(dy) >= Math.abs(dx)
            ? '↑'
            : dx > 0
              ? '→'
              : '←';
  return `${s.direction} ${arrow}（${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}）`;
}

/**
 * 校验一组手工顺序是否合法：
 * 必须是 0..n-1 的一个排列 —— 只允许改顺序，不允许增删笔、不允许改形状。
 */
export function isValidOrderPermutation(order: number[], strokeCount: number): boolean {
  if (!Array.isArray(order) || order.length !== strokeCount) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= strokeCount || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

/**
 * 形状指纹：只描述画出来的形状——笔画数、各笔闭合状态、起终点与折线点数。
 * 与排序规则版本无关；字形一改（增删笔、挪动、开合变化）即变化。
 */
export function shapeFingerprint(set: StrokeSet): string {
  const parts = set.strokes
    .slice()
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(
      (s) =>
        `${s.sourceIndex}:${s.closed ? 'z' : 'o'}:${s.points.length}:` +
        `${fmt(s.start.x)},${fmt(s.start.y)}>${fmt(s.end.x)},${fmt(s.end.y)}`
    );
  return `${set.strokes.length}|${parts.join('~')}`;
}

/**
 * 复核指纹：形状指纹 + 规则版本。
 * 规则版本上调（排序口径变化）或字形被改动，都会使旧的手工顺序判定为待复核。
 */
export function reviewFingerprint(set: StrokeSet): string {
  return `v${STROKE_RULE_VERSION}|${shapeFingerprint(set)}`;
}
