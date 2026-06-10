/**
 * Canvas 2D 水波纹效果 —— 基于 2D 波动方程的水面物理模拟
 *
 * Hugo Elias 经典水波算法，与 jquery.ripples (WebGL) 相同的物理模型。
 * 纯 Canvas 2D 实现，无外部依赖，不影响 Obsidian 交互 (pointer-events: none)。
 *
 * 鼠标交互：
 *   沿鼠标轨迹以极小步长连续写入扰动，形成一条连续的"划痕"。
 *   波从划痕两侧向外扩散，产生"手指划过水面"的锥形尾迹效果。
 */

type RipplePreset = {
    waterR: number;
    waterG: number;
    waterB: number;
    specR: number;
    specG: number;
    specB: number;
    waterColorScale: number;
    specAlpha: number;
    heightAlpha: number;
    canvasOpacity: number;
};

export class RippleEffect {
	// --- DOM ---
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private offscreen: HTMLCanvasElement | null = null;
	private offCtx: CanvasRenderingContext2D | null = null;

	// --- 状态 ---
	private animFrameId: number | null = null;
	private active = false;

	// --- 水面模拟 ---
	private cols = 0;
	private rows = 0;
	private readonly CELL_SIZE = 3;
	private buf1: Float32Array | null = null;
	private buf2: Float32Array | null = null;

	// --- 鼠标 ---
	private mouseX = -1000;
	private mouseY = -1000;
	private prevMouseX = -1000;
	private prevMouseY = -1000;

	// --- 自动涟漪 ---
	private nextAutoRippleTime = 0;
	private lastMouseMoveTime = 0;

	// --- 用户可控强度 (0~1，插件设置滑块控制) ---
	private intensity = 0.5;

	// --- 绑定的事件处理器 ---
	private readonly onMouseMoveBound: (e: MouseEvent) => void;
	private readonly onMouseLeaveBound: () => void;
	private readonly resizeBound: () => void;

	// =========================================================================
	//                                   所有可调参数
	// =========================================================================

	// ═══════════════════════════════════════════════════════════════════════════
	//  【一、物理参数】
	// ═══════════════════════════════════════════════════════════════════════════
	//
	//  物理公式（每帧每格）：
	//    new[i] = (四邻域旧值之和)/2 - new[i]        ← 波动传播
	//    new[i] *= DAMPING                           ← 能量衰减

	// ── DAMPING ───────────────────────────────────────────────────────────
	// 每帧乘在 new[i] 上。影响波纹传多远、多久消散。
	// 代码: this.buf2[i] = (...) * d;  (d = DAMPING, Float32 乘法)
	// 有效范围: 0 ≤ DAMPING < 1
	//   0      → 能量瞬间归零，波纹立即消失
	//   0.972  → 1秒剩18%, 2秒剩3%, 自然平静 (当前值)
	//   1.0    → 能量永不衰减，无限扩散
	//   >1.0   → 每帧能量放大，Float32 迅速溢出为 Infinity → NaN 污染全场
	//   负数    → 每帧正负翻转，视觉闪烁怪异
	private readonly DAMPING = 0.9;

	// ── MOUSE_TRAIL_STRENGTH ──────────────────────────────────────────────
	// 鼠标划过时写入高度场的峰值。最终值 = 此值 × intensity。
	// 代码: buf1[idx] += strength * exp(-d²/2σ²);  (直接写入 Float32Array)
	// 有效范围: 任意有限实数
	//   0      → 无扰动，划了等于没划
	//   0.14   → 温和划痕
	//   1   	→ 逼真划痕 (当前值)
	//   负数    → 扰动方向颠倒，波先凹后凸，视觉可用但不自然
	//   > 10   → 接近 Float32 溢出 (≈3.4e38)，产生 Infinity → NaN
	private readonly MOUSE_TRAIL_STRENGTH = 5;

	// ── MOUSE_TRAIL_WIDTH ─────────────────────────────────────────────────
	// 划痕高斯半径（模拟格子数，1格≈3px）。
	// 代码: const r = Math.ceil(radiusCells);  然后以 r 为半径遍历网格写入
	// 有效范围: > 0
	//   0 或负数 → Math.ceil(≤0) ≤ 0 → minX>maxX → 循环不执行 → 无效果
	//   0.5 → ceil=1, 影响 3×3 格子, 几乎看不见
	//   2.5 → ceil=3, 影响 7×7 格子, 自然 (当前值)
	//   巨大值 → 每次写入大片区域, CPU 开销线性增长但不崩溃
	private readonly MOUSE_TRAIL_WIDTH = 2;

	// ── MOUSE_TRAIL_STEP ──────────────────────────────────────────────────
	// 划痕沿轨迹的采样步长（像素）。
	// 代码: Math.ceil(dist / step);  用 n 控制 for 循环次数
	// 有效范围: > 0
	//   0      → 除以零 → n = Infinity → 无限循环 → 页面卡死
	//   负数    → n ≤ 0 → 循环不执行 → 无效果
	//   3      → 与 CELL_SIZE=3 对齐, 最优 (当前值)
	//   很大    → 采样稀疏, 回到"离散液滴"感
	private readonly MOUSE_TRAIL_STEP = 10;

	// ── AUTO_DROP_STRENGTH ────────────────────────────────────────────────
	// 自动涟漪基准强度（每个雨滴在此基础上随机缩放 0.3-1.2 倍）。
	private readonly AUTO_DROP_BASE_STRENGTH = 3;

	// ── AUTO_DROP_RADIUS ──────────────────────────────────────────────────
	// 雨滴半径范围 2~20 格，确保最小滴也覆盖 5×5 格以保持圆形。
	private readonly AUTO_DROP_MIN_RADIUS = 2;
	private readonly AUTO_DROP_MAX_RADIUS = 20;

	// ── AUTO_RIPPLE_SPEED ─────────────────────────────────────────────────
	// 自动涟漪速率 (0~1, 设置滑块控制)。
	//   speed=0.01(最慢): 667~1000ms, speed=1(最快): 33~333ms
	//   speed=0 关闭自动涟漪以节省性能
	// 每次触发时产生 1~3 个大小不一的随机雨滴，部分聚集，模拟真实下雨。
	private autoRippleSpeed = 0.5;

	// ═══════════════════════════════════════════════════════════════════════════
	//  【二、渲染参数】
	// ═══════════════════════════════════════════════════════════════════════════
	//
	//  渲染公式（每像素）：
	//    表面法线 = normalize(cross((0,1,dy), (1,0,dx))) = normalize(-dhdx*S, 1, -dhdy*S)
	//    specular = pow(max(0, normal · light3D), SPECULAR_POWER)          // [0,1]
	//    color    = waterColor + specular×specColor                         // 水底色→高光色
	//    alpha    = baseAlpha + sqrt(|height|)×heightAlpha + specular×specAlpha
	//
	//  注意：法线 y 分量恒为 1（cross product 的结构决定），始终为正。
	//  因此高光在波峰↔波谷振荡时不会翻转到对面，只会在波面两侧微移。

	// ── LIGHT_X / LIGHT_Y ─────────────────────────────────────────────────
	// 光照方向 2D 向量 (xy 分量)，来自 jquery.ripples。
	// 高光斑出现在朝向光源的波面一侧。
	// 代码: light3D = normalize(X, Y, LZ)
	// 有效范围: 不能同时为 0
	//   (0,0) → 除以零 → NaN 污染全屏
	private readonly LIGHT_X = -0.6;
	private readonly LIGHT_Y = 1.0;

	// ── LZ ────────────────────────────────────────────────────────────────
	// 光照 Z 分量（光源高度）。
	// 代码: light3D = normalize(LIGHT_X, LIGHT_Y, LZ)
	// 有效范围: 任意实数（除数不为零即可）
	//   0      → 光源平掠水面, 法线 z 分量没有贡献
	//   0.35   → 斜上方照射, 给法线 z 分量一定权重 (当前值)
	//   很大    → 近似顶光, 高光方向性减弱, 趋于均匀
	//   负数    → 光源从下方照, 不自然但代码可用
	private readonly LZ = 0.35;

	// ── HEIGHT_SCALE ──────────────────────────────────────────────────────
	// 梯度→法线倾斜度的放大系数。
	// 代码: normal = normalize(-dhdx*HS, 1, -dhdy*HS)
	// 有效范围: 任意实数（仅影响法线朝向，不会越界）
	//   1      → 法线几乎垂直（梯度值太小），高光弱且均匀
	//   12     → 法线充分倾斜，高光有明显方向性 (当前值)
	//   100    → 法线极度倾斜，高光极其集中、接近二值化
	//   负数    → 法线方向反转，高光出现在相反方向
	private readonly HEIGHT_SCALE = 12;

	// ── SPECULAR_POWER ────────────────────────────────────────────────────
	// Phong 高光指数。控制高光斑的锐利程度。
	// 代码: specular = pow(max(0, normal·light3D), SPECULAR_POWER)   // dot∈[0,1]
	// 有效范围: ≥ 0
	//   0      → pow(x,0)=1 → 高光柔和散布, 无方向性
	//   10      → 高光锐利, 有明显方向性 (当前值)
	//   负数    → pow(0.5,-2)=4 → 逻辑可用但不合物理直觉
	//   极大值   → pow(0.99,1000)≈0 → 高光过于集中到几乎不可见
	private readonly SPECULAR_POWER = 20;

	// ═══════════════════════════════════════════════════════════════════════════
	//  【三、暗色/亮色双套预设】—— 运行时根据 Obsidian body 的 theme-dark 自动切换
	// ═══════════════════════════════════════════════════════════════════════════
	//
	//  intensity 只影响物理扰动强度（鼠标划痕、自动涟漪），不影响渲染 alpha。
	//  预设中的 alpha / canvasOpacity 值直接对应视觉效果。

	// ── waterR / waterG / waterB ───────────────────────────────────────────
	// 水面底色 RGB。白色高光叠加在此颜色之上。
	// 代码: data[p]=min(255, waterR+specular×255);  写入 Uint8ClampedArray
	// 有效范围: 任意实数（Uint8ClampedArray 自动钳位到 [0, 255]）
	//   负数    → 钳位为 0（纯黑）
	//   0~255   → 正常 (当前值)
	//   > 255   → 钳位为 255（纯白）
	// 亮色模式需要较深底色才能在白色背景上形成对比。

	// ── specAlpha ──────────────────────────────────────────────────────────
	// 高光斑的不透明度系数。
	// 代码: alpha = min(1, ... + specular × specAlpha);
	//       data[p+3] = round(alpha × 255);  → Uint8ClampedArray 钳位 [0,255]
	// 有效范围: 任意实数
	//   负数   → alpha 可能为负 → clamp 为 0（全透明）
	//   0      → 高光不可见
	//   很大    → alpha 被 min(1,...) 截断为 1（完全不透明）

	// ── heightAlpha ────────────────────────────────────────────────────────
	// 波纹高度对不透明度的贡献。在所有有波的地方均生效（比 specAlpha 范围广）。
	// 代码: alpha = min(1, ... + |height| × heightAlpha);
	// 有效范围: 任意实数（同 specAlpha）

	// ── canvasOpacity ──────────────────────────────────────────────────────
	// 波纹可见度系数（乘入像素 alpha，不再用 CSS opacity 避免全屏遮罩）。
	// 代码: pixelAlpha *= canvasOpacity * (0.5 + intensity*0.5)
	// 有效范围: 任意实数（alpha 钳位到 [0, 1]）
	//   0      → 完全不可见

	// ── waterColorScale ────────────────────────────────────────────────────
	// 水色随波纹高度渐显的速率（暗亮分开）。暗色不需蓝底（白高光已可见），
	// 亮色需要蓝底才能让白高光可见。
	// 代码: waterTint = min(1, |height| * waterColorScale)

	// ── 预设类型 ───────────────────────────────────────────────────────────
	//  亮色 alpha 值需高于暗色，因为白色背景需要更强不透明度才能可见。

	private readonly DARK_PRESETS: Record<string, RipplePreset> = {
		//  暗色模式：可见性主要靠 specular（白亮斑在暗底上），hAlpha 提高让水色也参与显色。
		'classic-blue': {  // 经典蓝白 — 纯白高光 + 淡蓝底
			waterR: 170, waterG: 200, waterB: 245,
			specR: 255, specG: 255, specB: 255,
			waterColorScale: 4, specAlpha: 0.70, heightAlpha: 0.25, canvasOpacity: 0.65,
		},
		'crystal': {  // 水晶清透 — 纯白高光 + 清透蓝底
			waterR: 185, waterG: 215, waterB: 250,
			specR: 255, specG: 255, specB: 255,
			waterColorScale: 3, specAlpha: 0.72, heightAlpha: 0.25, canvasOpacity: 0.65,
		},
		'pearl': {  // 珍珠虹彩 — 暖白高光 + 紫底
			waterR: 215, waterG: 195, waterB: 250,
			specR: 255, specG: 252, specB: 235,
			waterColorScale: 4, specAlpha: 0.70, heightAlpha: 0.25, canvasOpacity: 0.65,
		},
		'sunrise': {  // 旭日暖金 — 暖金高光 + 琥珀底
			waterR: 210, waterG: 180, waterB: 135,
			specR: 255, specG: 248, specB: 195,
			waterColorScale: 6, specAlpha: 0.72, heightAlpha: 0.28, canvasOpacity: 0.65,
		},
		'aurora': {  // 极光彩 — 粉紫高光 + 深蓝底
			waterR: 170, waterG: 200, waterB: 255,
			specR: 255, specG: 210, specB: 255,
			waterColorScale: 4, specAlpha: 0.70, heightAlpha: 0.25, canvasOpacity: 0.65,
		},
		'pure-white': {  // 纯白 — 纯白高光，最干净
			waterR: 195, waterG: 210, waterB: 240,
			specR: 255, specG: 255, specB: 255,
			waterColorScale: 2, specAlpha: 0.75, heightAlpha: 0.25, canvasOpacity: 0.65,
		},
	};

	private readonly LIGHT_PRESETS: Record<string, RipplePreset> = {
		//  亮色模式：可见性主要靠 waterColor 与白底的色差 + 高 alpha。
		//  waterColor 需要在 200~240 区间才能与白底形成有效对比。
		'warm-gold': {  // 暖金 — 金黄底 + 暖黄高光（与白底色差 20~55）
			waterR: 235, waterG: 230, waterB: 200,
			specR: 255, specG: 245, specB: 195,
			waterColorScale: 5, specAlpha: 0.80, heightAlpha: 0.80, canvasOpacity: 0.85,
		},
		'crystal': {  // 水晶清透 — 淡蓝底 + 纯白高光（与白底色差 3~35）
			waterR: 220, waterG: 235, waterB: 252,
			specR: 255, specG: 255, specB: 252,
			waterColorScale: 6, specAlpha: 0.80, heightAlpha: 0.80, canvasOpacity: 0.85,
		},
		'pearl': {  // 珍珠虹彩 — 粉紫底 + 暖白高光（与白底色差 5~30）
			waterR: 242, waterG: 225, waterB: 250,
			specR: 255, specG: 252, specB: 220,
			waterColorScale: 5, specAlpha: 0.80, heightAlpha: 0.80, canvasOpacity: 0.85,
		},
		'sunrise': {  // 旭日暖金 — 浓金底 + 暖白高光（与白底色差 10~80，最显眼）
			waterR: 245, waterG: 215, waterB: 175,
			specR: 255, specG: 255, specB: 225,
			waterColorScale: 8, specAlpha: 0.80, heightAlpha: 0.80, canvasOpacity: 0.85,
		},
		'refraction': {  // 偏光折射 — 蓝底 + 暖黄高光（与白底色差 0~40，冷暖对比）
			waterR: 215, waterG: 235, waterB: 255,
			specR: 255, specG: 235, specB: 195,
			waterColorScale: 6, specAlpha: 0.82, heightAlpha: 0.80, canvasOpacity: 0.85,
		},
		'dawn': {  // 晨曦微光 — 暖底 + 粉金高光（与白底色差 10~35，最柔和）
			waterR: 245, waterG: 232, waterB: 220,
			specR: 255, specG: 238, specB: 205,
			waterColorScale: 4, specAlpha: 0.70, heightAlpha: 0.70, canvasOpacity: 0.85,
		},
		'mist': {  // 薄雾 — 极淡清透，若隐若现（与白底色差 3~10）
			waterR: 235, waterG: 238, waterB: 248,
			specR: 255, specG: 255, specB: 255,
			waterColorScale: 3, specAlpha: 0.95, heightAlpha: 0.95, canvasOpacity: 0.95,
		},
	};

	//  当前激活的预设（运行时由 setPreset() 覆写）
	private dark: RipplePreset = { ...this.DARK_PRESETS['classic-blue'] };
	private light: RipplePreset = { ...this.LIGHT_PRESETS['warm-gold'] };

	// =========================================================================

	// ...（以下代码无需修改）...

	private isDarkMode(): boolean {
		return document.body.classList.contains('theme-dark');
	}

	constructor() {
		this.onMouseMoveBound = this.onMouseMove.bind(this);
		this.onMouseLeaveBound = this.onMouseLeave.bind(this);
		this.resizeBound = this.onResize.bind(this);
	}

	// ====================================================================
	// Public API
	// ====================================================================

	public start(): void {
		if (this.active) return;
		this.active = true;

		this.canvas = document.createElement('canvas');
		this.canvas.classList.add('minidoro-ripple-canvas');
		this.canvas.style.cssText = `
			position: fixed; top: 0; left: 0; width: 100%; height: 100%;
			pointer-events: none; z-index: 0;
		`;
		document.body.appendChild(this.canvas);
		this.ctx = this.canvas.getContext('2d');

		this.offscreen = document.createElement('canvas');
		this.offCtx = this.offscreen.getContext('2d');

		this.initSimulation();
		this.nextAutoRippleTime = performance.now() + this.randomAutoInterval();

		window.addEventListener('resize', this.resizeBound);
		document.addEventListener('mousemove', this.onMouseMoveBound, { passive: true });
		document.addEventListener('mouseleave', this.onMouseLeaveBound);

		this.animFrameId = requestAnimationFrame(this.animate);
	}

	public stop(): void {
		if (!this.active) return;
		this.active = false;

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		this.canvas?.remove();
		this.canvas = null;
		this.ctx = null;
		this.offscreen = null;
		this.offCtx = null;
		this.buf1 = null;
		this.buf2 = null;

		window.removeEventListener('resize', this.resizeBound);
		document.removeEventListener('mousemove', this.onMouseMoveBound);
		document.removeEventListener('mouseleave', this.onMouseLeaveBound);
	}

	public isActive(): boolean {
		return this.active;
	}

	public setIntensity(value: number): void {
		this.intensity = Math.max(0, Math.min(1, value));
	}

	/** 设置亮/暗模式的预设配色。name 为预设键名，mode 为 'dark' 或 'light'。 */
	public setPreset(name: string, mode: 'dark' | 'light'): void {
		const presets = mode === 'dark' ? this.DARK_PRESETS : this.LIGHT_PRESETS;
		const preset = presets[name];
		if (!preset) return;
		if (mode === 'dark') {
			Object.assign(this.dark, preset);
		} else {
			Object.assign(this.light, preset);
		}
	}

	/** 获取指定模式的所有预设名称列表（供设置下拉框使用）。 */
	public getPresetNames(mode: 'dark' | 'light'): string[] {
		const presets = mode === 'dark' ? this.DARK_PRESETS : this.LIGHT_PRESETS;
		return Object.keys(presets);
	}

	// ====================================================================
	// 初始化 / 重置模拟
	// ====================================================================

	private onResize(): void {
		if (!this.canvas) return;
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.initSimulation();
	}

	private initSimulation(): void {
		const w = window.innerWidth;
		const h = window.innerHeight;

		this.cols = Math.ceil(w / this.CELL_SIZE) + 2;
		this.rows = Math.ceil(h / this.CELL_SIZE) + 2;
		const len = this.cols * this.rows;

		this.buf1 = new Float32Array(len);
		this.buf2 = new Float32Array(len);

		if (this.offscreen) {
			this.offscreen.width = this.cols;
			this.offscreen.height = this.rows;
		}
		if (this.canvas) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
	}

	// ====================================================================
	// 鼠标交互 —— 连续划痕
	// ====================================================================

	private onMouseMove(e: MouseEvent): void {
		this.mouseX = e.clientX;
		this.mouseY = e.clientY;
		this.lastMouseMoveTime = performance.now();
	}

	private onMouseLeave(): void {
		this.mouseX = -1000;
		this.mouseY = -1000;
	}

	private applyMouseTrail(): void {
		if (this.mouseX < 0 || !this.buf1) return;

		const dx = this.mouseX - this.prevMouseX;
		const dy = this.mouseY - this.prevMouseY;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist < 0.5) {
			// 鼠标静止时不注入扰动，避免在光标处堆积形成"油坨"
			return;
		}

		const strength = this.MOUSE_TRAIL_STRENGTH * this.intensity;
		const width = this.MOUSE_TRAIL_WIDTH;
		const step = this.MOUSE_TRAIL_STEP;
		const n = Math.ceil(dist / step);

		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const px = this.prevMouseX + dx * t;
			const py = this.prevMouseY + dy * t;
			this.addGaussian(px, py, width, strength);
		}
	}

	private addGaussian(sx: number, sy: number, radiusCells: number, strength: number): void {
		if (!this.buf1) return;

		const cx = sx / this.CELL_SIZE;
		const cy = sy / this.CELL_SIZE;
		const r = Math.ceil(radiusCells);

		const minX = Math.max(1, Math.floor(cx - r));
		const maxX = Math.min(this.cols - 2, Math.ceil(cx + r));
		const minY = Math.max(1, Math.floor(cy - r));
		const maxY = Math.min(this.rows - 2, Math.ceil(cy + r));

		const sigma = Math.max(0.5, radiusCells / 2.5);
		const twoSigma2 = 2 * sigma * sigma;

		for (let y = minY; y <= maxY; y++) {
			const rowOffset = y * this.cols;
			const dy2 = (y - cy) * (y - cy);
			for (let x = minX; x <= maxX; x++) {
				const d2 = (x - cx) * (x - cx) + dy2;
				this.buf1[rowOffset + x] += strength * Math.exp(-d2 / twoSigma2);
			}
		}
	}

	// ====================================================================
	// 自动涟漪
	// ====================================================================

	private randomAutoInterval(): number {
		// speed=0.01(最慢): 667~1000ms, speed=1(最快): 33~333ms
		const min = 2000 - this.autoRippleSpeed * 1900;
		const max = 3000 - this.autoRippleSpeed * 2000;
		return min + Math.random() * (max - min);
	}

	public setAutoRippleSpeed(speed: number): void {
		this.autoRippleSpeed = Math.max(0, Math.min(1, speed));
	}

	private applyAutoRipples(now: number): void {
		if (this.autoRippleSpeed <= 0) return;
		if (now < this.nextAutoRippleTime) return;
		// 鼠标最近 500ms 内移动过 → 不触发自动涟漪
		if (now - this.lastMouseMoveTime < 500) return;

		// 生成下一次的随机间隔
		this.nextAutoRippleTime = now + this.randomAutoInterval();

		// ── 雨滴簇：每次产生 1~3 个随机大小、聚集在 200px 范围内的雨滴 ──
		const dropCount = Math.random() < 0.35 ? 3 : (Math.random() < 0.5 ? 2 : 1);
		const clusterCx = Math.random() * window.innerWidth;
		const clusterCy = Math.random() * window.innerHeight;
		const clusterSpread = 200;

		for (let i = 0; i < dropCount; i++) {
			// 半径在 0.3~20 格之间随机，偏向中值以模拟多数中等雨滴
			const t = Math.random();
			const radius = this.AUTO_DROP_MIN_RADIUS +
				t * t * (this.AUTO_DROP_MAX_RADIUS - this.AUTO_DROP_MIN_RADIUS);
			// 强度按半径平方缩放：小滴近乎消失，大滴明显飞溅
			const ratio = radius / this.AUTO_DROP_MAX_RADIUS;
			const strength = this.AUTO_DROP_BASE_STRENGTH * this.intensity *
				(0.05 + 0.95 * ratio * ratio);

			const x = clusterCx + (Math.random() - 0.5) * clusterSpread;
			const y = clusterCy + (Math.random() - 0.5) * clusterSpread;
			this.addGaussian(x, y, radius, strength);
		}
	}

	// ====================================================================
	// 波动方程
	// ====================================================================

	private waveStep(): void {
		if (!this.buf1 || !this.buf2) return;

		const cols = this.cols;
		const rows = this.rows;
		const d = this.DAMPING;

		for (let y = 1; y < rows - 1; y++) {
			const rowOffset = y * cols;
			for (let x = 1; x < cols - 1; x++) {
				const i = rowOffset + x;
				this.buf2[i] = (
					(this.buf1[i - 1] + this.buf1[i + 1] + this.buf1[i - cols] + this.buf1[i + cols]) * 0.5
					- this.buf2[i]
				) * d;
			}
		}

		for (let x = 0; x < cols; x++) {
			this.buf2[x] = 0;
			this.buf2[(rows - 1) * cols + x] = 0;
		}
		for (let y = 0; y < rows; y++) {
			this.buf2[y * cols] = 0;
			this.buf2[y * cols + cols - 1] = 0;
		}

		const tmp = this.buf1;
		this.buf1 = this.buf2;
		this.buf2 = tmp;
	}

	// ====================================================================
	// 渲染
	// ====================================================================

	private animate = (): void => {
		if (!this.active) return;

		const now = performance.now();

		this.applyMouseTrail();
		this.prevMouseX = this.mouseX;
		this.prevMouseY = this.mouseY;

		this.applyAutoRipples(now);
		this.waveStep();
		this.render();

		this.animFrameId = requestAnimationFrame(this.animate);
	};

	private render(): void {
		if (!this.ctx || !this.canvas || !this.offCtx || !this.offscreen || !this.buf1) return;

		const cols = this.cols;
		const rows = this.rows;
		const imageData = this.offCtx.getImageData(0, 0, cols, rows);
		const data = imageData.data;

		const lLen = Math.sqrt(this.LIGHT_X * this.LIGHT_X + this.LIGHT_Y * this.LIGHT_Y);
		const lx = this.LIGHT_X / lLen;
		const ly = this.LIGHT_Y / lLen;

		const preset = this.isDarkMode() ? this.dark : this.light;

		// 全局透明度乘数（原 CSS opacity），直接乘入像素 alpha
		const gFactor = preset.canvasOpacity;
		this.canvas.style.opacity = '1';

		const wr = preset.waterR;
		const wg = preset.waterG;
		const wb = preset.waterB;
		const specR = preset.specR;
		const specG = preset.specG;
		const specB = preset.specB;
		const sp = this.SPECULAR_POWER;
		const sAlpha = preset.specAlpha;
		const hAlpha = preset.heightAlpha;

		// 3D 光照方向 (含 z 分量，模拟光源从斜上方照射)
		// xy 沿用原版 (-0.6, 1.0)，z 控制光源高度（越小越平掠、越大越顶光）
		const lLen3 = Math.sqrt(lx * lx + ly * ly + this.LZ * this.LZ);
		const lx3 = lx / lLen3;
		const ly3 = ly / lLen3;
		const lz3 = this.LZ / lLen3;

		for (let y = 1; y < rows - 1; y++) {
			for (let x = 1; x < cols - 1; x++) {
				const i = y * cols + x;

				const dhdx = (this.buf1[i + 1] - this.buf1[i - 1]) * 0.5;
				const dhdy = (this.buf1[i - cols] - this.buf1[i + cols]) * 0.5;

				// 平坦水面不计算高光，否则全屏残留 specular 造成遮罩
				const gLen = Math.sqrt(dhdx * dhdx + dhdy * dhdy);
				let specular = 0;
				if (gLen > 0.0001) {
					const nx = -dhdx * this.HEIGHT_SCALE;
					const ny = 1.0;
					const nz = -dhdy * this.HEIGHT_SCALE;
					const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
					const dotNL = (nx / nLen) * lx3 + (ny / nLen) * ly3 + (nz / nLen) * lz3;
					specular = Math.pow(Math.max(0, dotNL), sp);
				}

				// 水色随波纹幅度渐显：平坦→纯白，波浪→浅蓝底衬
				const mag = Math.abs(this.buf1[i]);
				const waterTint = Math.min(1, mag * preset.waterColorScale);

				const sr = Math.round((255 - waterTint * (255 - wr)) * (1 - specular) + specR * specular);
				const sg = Math.round((255 - waterTint * (255 - wg)) * (1 - specular) + specG * specular);
				const sb = Math.round((255 - waterTint * (255 - wb)) * (1 - specular) + specB * specular);

				// sqrt(mag) 替代 mag：波尾 alpha 衰减更平缓，在白色背景上仍可见
				const rawAlpha = (Math.sqrt(mag) * hAlpha + specular * sAlpha) * gFactor;
				const alpha = rawAlpha < 0.004 ? 0 : Math.min(1, rawAlpha);

				const p = i * 4;
				data[p]     = sr;
				data[p + 1] = sg;
				data[p + 2] = sb;
				data[p + 3] = Math.round(alpha * 255);
			}
		}

		this.offCtx.putImageData(imageData, 0, 0);

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.imageSmoothingEnabled = true;
		this.ctx.imageSmoothingQuality = 'medium';
		this.ctx.drawImage(
			this.offscreen,
			0, 0, cols, rows,
			0, 0, this.canvas.width, this.canvas.height,
		);
	}
}
