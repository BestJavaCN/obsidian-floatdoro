/**
 * Canvas 2D 水波纹效果
 * 全屏透明 canvas overlay，鼠标移动时产生涟漪扩散效果
 * 不影响 Obsidian 原有界面交互（pointer-events: none）
 */

interface Ripple {
	x: number;
	y: number;
	radius: number;
	maxRadius: number;
	opacity: number;
}

interface WavePoint {
	x: number;
	y: number;
	angle: number;
	speed: number;
	amplitude: number;
	phase: number;
}

export class RippleEffect {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private animFrameId: number | null = null;
	private ripples: Ripple[] = [];
	private wavePoints: WavePoint[] = [];
	private mouseX = 0;
	private mouseY = 0;
	private lastMouseX = 0;
	private lastMouseY = 0;
	private mouseActive = false;
	private time = 0;
	private active = false;
	private onMouseMoveBound: (e: MouseEvent) => void;

	// 水波纹参数
	private readonly MAX_RIPPLES = 30;
	private readonly RIPPLE_LIFETIME = 1.5; // 秒
	private readonly WAVE_LINES = 6; // 波浪线条数

	constructor() {
		this.onMouseMoveBound = this.onMouseMove.bind(this);
	}

	/**
	 * 启动水波纹效果
	 */
	public start(): void {
		if (this.active) return;
		this.active = true;

		this.canvas = document.createElement('canvas');
		this.canvas.classList.add('minidoro-ripple-canvas');
		this.canvas.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			pointer-events: none;
			z-index: 0;
			opacity: 0.5;
		`;
		document.body.appendChild(this.canvas);

		this.ctx = this.canvas.getContext('2d');
		this.resize();
		this.initWavePoints();

		window.addEventListener('resize', this.resizeBound);
		document.addEventListener('mousemove', this.onMouseMoveBound);

		this.animate();
	}

	/**
	 * 停止水波纹效果并清理
	 */
	public stop(): void {
		if (!this.active) return;
		this.active = false;

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		if (this.canvas) {
			this.canvas.remove();
			this.canvas = null;
			this.ctx = null;
		}

		window.removeEventListener('resize', this.resizeBound);
		document.removeEventListener('mousemove', this.onMouseMoveBound);

		this.ripples = [];
		this.wavePoints = [];
		this.mouseActive = false;
	}

	/**
	 * 获取当前激活状态
	 */
	public isActive(): boolean {
		return this.active;
	}

	private resizeBound = (): void => {
		this.resize();
	};

	private resize(): void {
		if (!this.canvas) return;
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	private initWavePoints(): void {
		this.wavePoints = [];
		for (let i = 0; i < this.WAVE_LINES; i++) {
			const y = (window.innerHeight / (this.WAVE_LINES + 1)) * (i + 1);
			this.wavePoints.push({
				x: 0,
				y,
				angle: Math.random() * Math.PI * 2,
				speed: 0.3 + Math.random() * 0.4,
				amplitude: 15 + Math.random() * 25,
				phase: Math.random() * Math.PI * 2,
			});
		}
	}

	private onMouseMove(e: MouseEvent): void {
		this.mouseX = e.clientX;
		this.mouseY = e.clientY;

		// 如果鼠标移动了足够距离，产生新涟漪
		const dx = this.mouseX - this.lastMouseX;
		const dy = this.mouseY - this.lastMouseY;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist > 30 && this.ripples.length < this.MAX_RIPPLES) {
			this.ripples.push({
				x: this.mouseX,
				y: this.mouseY,
				radius: 0,
				maxRadius: 80 + Math.random() * 60,
				opacity: 0.6,
			});
			this.lastMouseX = this.mouseX;
			this.lastMouseY = this.mouseY;
		}

		if (!this.mouseActive) {
			this.mouseActive = true;
			this.lastMouseX = this.mouseX;
			this.lastMouseY = this.mouseY;
		}
	}

	private animate = (): void => {
		if (!this.active) return;

		const dt = 16 / 1000; // ~60fps
		this.time += dt;

		if (!this.ctx || !this.canvas) return;

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// 绘制波浪线条
		this.drawWaveLines();

		// 绘制鼠标涟漪
		this.drawRipples(dt);

		this.animFrameId = requestAnimationFrame(this.animate);
	};

	private drawWaveLines(): void {
		if (!this.ctx || !this.canvas) return;

		const ctx = this.ctx;
		const w = this.canvas.width;

		for (const wp of this.wavePoints) {
			wp.angle += wp.speed * 0.016;
			ctx.beginPath();
			ctx.strokeStyle = `rgba(100, 150, 220, 0.06)`;
			ctx.lineWidth = 1;

			const segments = 80;
			const step = w / segments;

			for (let i = 0; i <= segments; i++) {
				const x = i * step;
				const y = wp.y + Math.sin(x * 0.005 + wp.angle + wp.phase) * wp.amplitude
					+ Math.sin(x * 0.012 + wp.angle * 1.3) * wp.amplitude * 0.5;

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
	}

	private drawRipples(dt: number): void {
		if (!this.ctx) return;

		const ctx = this.ctx;

		// 更新并绘制涟漪
		for (let i = this.ripples.length - 1; i >= 0; i--) {
			const r = this.ripples[i];
			r.radius += 60 * dt;
			r.opacity -= 0.6 * dt;

			if (r.opacity <= 0 || r.radius >= r.maxRadius) {
				this.ripples.splice(i, 1);
				continue;
			}

			const progress = r.radius / r.maxRadius;
			const alpha = r.opacity * (1 - progress);

			ctx.beginPath();
			ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);

			// 外圈
			ctx.strokeStyle = `rgba(100, 160, 230, ${alpha * 0.5})`;
			ctx.lineWidth = 1.5 * (1 - progress);
			ctx.stroke();

			// 内圈光晕
			if (r.radius > 5) {
				ctx.beginPath();
				ctx.arc(r.x, r.y, r.radius * 0.8, 0, Math.PI * 2);
				ctx.strokeStyle = `rgba(140, 190, 250, ${alpha * 0.3})`;
				ctx.lineWidth = 3 * (1 - progress);
				ctx.stroke();
			}
		}
	}
}