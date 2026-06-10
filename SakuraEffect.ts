/**
 * WebGL 樱花粒子效果
 * 全屏 WebGL canvas overlay，渲染悬浮樱花花瓣
 * 不影响 Obsidian 原有界面交互（pointer-events: none）
 */

// ====== Vector3 & Matrix44 工具函数 ======

interface Vec3 { x: number; y: number; z: number; array?: Float32Array; }

const Vec3 = {
	create(x: number, y: number, z: number): Vec3 {
		return { x, y, z };
	},
	dot(v0: Vec3, v1: Vec3): number {
		return v0.x * v1.x + v0.y * v1.y + v0.z * v1.z;
	},
	cross(v: Vec3, v0: Vec3, v1: Vec3): void {
		v.x = v0.y * v1.z - v0.z * v1.y;
		v.y = v0.z * v1.x - v0.x * v1.z;
		v.z = v0.x * v1.y - v0.y * v1.x;
	},
	normalize(v: Vec3): void {
		let l = v.x * v.x + v.y * v.y + v.z * v.z;
		if (l > 0.00001) {
			l = 1.0 / Math.sqrt(l);
			v.x *= l;
			v.y *= l;
			v.z *= l;
		}
	},
	arrayForm(v: Vec3): Float32Array {
		if (v.array) {
			v.array[0] = v.x;
			v.array[1] = v.y;
			v.array[2] = v.z;
		} else {
			v.array = new Float32Array([v.x, v.y, v.z]);
		}
		return v.array;
	},
};

const Mat4 = {
	createIdentity(): Float32Array {
		return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	},
	loadProjection(m: Float32Array, aspect: number, vdeg: number, near: number, far: number): void {
		const h = near * Math.tan((vdeg * Math.PI) / 180.0 * 0.5) * 2.0;
		const w = h * aspect;
		m[0] = (2.0 * near) / w;  m[1] = 0;                 m[2] = 0;                       m[3] = 0;
		m[4] = 0;                  m[5] = (2.0 * near) / h;  m[6] = 0;                       m[7] = 0;
		m[8] = 0;                  m[9] = 0;                  m[10] = -(far + near) / (far - near); m[11] = -1;
		m[12] = 0;                 m[13] = 0;                 m[14] = (-2.0 * far * near) / (far - near); m[15] = 0;
	},
	loadLookAt(m: Float32Array, vpos: Vec3, vlook: Vec3, vup: Vec3): void {
		const frontv = Vec3.create(vpos.x - vlook.x, vpos.y - vlook.y, vpos.z - vlook.z);
		Vec3.normalize(frontv);
		const sidev = Vec3.create(1, 0, 0);
		Vec3.cross(sidev, vup, frontv);
		Vec3.normalize(sidev);
		const topv = Vec3.create(1, 0, 0);
		Vec3.cross(topv, frontv, sidev);
		Vec3.normalize(topv);
		m[0] = sidev.x;  m[1] = topv.x;  m[2] = frontv.x;  m[3] = 0;
		m[4] = sidev.y;  m[5] = topv.y;  m[6] = frontv.y;  m[7] = 0;
		m[8] = sidev.z;  m[9] = topv.z;  m[10] = frontv.z; m[11] = 0;
		m[12] = -(vpos.x * m[0] + vpos.y * m[4] + vpos.z * m[8]);
		m[13] = -(vpos.x * m[1] + vpos.y * m[5] + vpos.z * m[9]);
		m[14] = -(vpos.x * m[2] + vpos.y * m[6] + vpos.z * m[10]);
		m[15] = 1;
	},
};

// ====== Shader 源码 ======

const SAKURA_POINT_VSH = `
uniform mat4 uProjection;
uniform mat4 uModelview;
uniform vec3 uResolution;
uniform vec3 uOffset;
uniform vec3 uDOF;
uniform vec3 uFade;
attribute vec3 aPosition;
attribute vec3 aEuler;
attribute vec2 aMisc;
varying vec3 pposition;
varying float psize;
varying float palpha;
varying float pdist;
varying vec3 normX;
varying vec3 normY;
varying vec3 normZ;
varying vec3 normal;
varying float diffuse;
varying float specular;
varying float rstop;
varying float distancefade;
void main(void) {
	vec4 pos = uModelview * vec4(aPosition + uOffset, 1.0);
	gl_Position = uProjection * pos;
	gl_PointSize = aMisc.x * uProjection[1][1] / -pos.z * uResolution.y * 0.5;
	pposition = pos.xyz;
	psize = aMisc.x;
	pdist = length(pos.xyz);
	palpha = smoothstep(0.0, 1.0, (pdist - 0.1) / uFade.z);
	vec3 elrsn = sin(aEuler);
	vec3 elrcs = cos(aEuler);
	mat3 rotx = mat3(1.0,0.0,0.0, 0.0,elrcs.x,elrsn.x, 0.0,-elrsn.x,elrcs.x);
	mat3 roty = mat3(elrcs.y,0.0,-elrsn.y, 0.0,1.0,0.0, elrsn.y,0.0,elrcs.y);
	mat3 rotz = mat3(elrcs.z,elrsn.z,0.0, -elrsn.z,elrcs.z,0.0, 0.0,0.0,1.0);
	mat3 rotmat = rotx * roty * rotz;
	normal = rotmat[2];
	mat3 trrotm = mat3(rotmat[0][0],rotmat[1][0],rotmat[2][0], rotmat[0][1],rotmat[1][1],rotmat[2][1], rotmat[0][2],rotmat[1][2],rotmat[2][2]);
	normX = trrotm[0];
	normY = trrotm[1];
	normZ = trrotm[2];
	const vec3 lit = vec3(0.6917144638660746, 0.6917144638660746, -0.20751433915982237);
	float tmpdfs = dot(lit, normal);
	if(tmpdfs < 0.0) { normal = -normal; tmpdfs = dot(lit, normal); }
	diffuse = 0.4 + tmpdfs;
	vec3 eyev = normalize(-pos.xyz);
	if(dot(eyev, normal) > 0.0) {
		vec3 hv = normalize(eyev + lit);
		specular = pow(max(dot(hv, normal), 0.0), 20.0);
	} else { specular = 0.0; }
	rstop = clamp((abs(pdist - uDOF.x) - uDOF.y) / uDOF.z, 0.0, 1.0);
	rstop = pow(rstop, 0.5);
	distancefade = min(1.0, exp((uFade.x - pdist) * 0.69315 / uFade.y));
}`;

const SAKURA_POINT_FSH = `
#ifdef GL_ES
precision highp float;
#endif
uniform vec3 uDOF;
uniform vec3 uFade;
const vec3 fadeCol = vec3(0.08, 0.03, 0.06);
uniform vec4 uThemeColor;
varying vec3 pposition;
varying float psize;
varying float palpha;
varying float pdist;
varying vec3 normX;
varying vec3 normY;
varying vec3 normZ;
varying vec3 normal;
varying float diffuse;
varying float specular;
varying float rstop;
varying float distancefade;
float ellipse(vec2 p, vec2 o, vec2 r) {
	vec2 lp = (p - o) / r;
	return length(lp) - 1.0;
}
void main(void) {
	vec3 p = vec3(gl_PointCoord - vec2(0.5, 0.5), 0.0) * 2.0;
	vec3 d = vec3(0.0, 0.0, -1.0);
	float nd = normZ.z;
	if(abs(nd) < 0.0001) discard;
	float np = dot(normZ, p);
	vec3 tp = p + d * np / nd;
	vec2 coord = vec2(dot(normX, tp), dot(normY, tp));
	const float flwrsn = 0.28819045102521;
	const float flwrcs = 0.965925826289068;
	mat2 flwrm = mat2(flwrcs, -flwrsn, flwrsn, flwrcs);
	vec2 flwrp = vec2(abs(coord.x), coord.y) * flwrm;
	float r;
	float r_glow;
	if(flwrp.x < 0.0) {
		r = ellipse(flwrp, vec2(0.065, 0.024) * 0.5, vec2(0.36, 0.96) * 0.5);
		r_glow = ellipse(flwrp, vec2(0.065, 0.024) * 0.5, vec2(0.36, 0.96) * 0.5 * 2.0);
	} else {
		r = ellipse(flwrp, vec2(0.065, 0.024) * 0.5, vec2(0.58, 0.96) * 0.5);
		r_glow = ellipse(flwrp, vec2(0.065, 0.024) * 0.5, vec2(0.58, 0.96) * 0.5 * 2.0);
	}
	if(r_glow > 0.0) discard;

	// 预先计算花瓣基础色（光晕区也共用）
	vec3 petalCol = mix(vec3(1.0, 0.9, 0.75), vec3(1.0, 0.9, 0.87), r);
	float grady = mix(0.0, 1.0, pow(coord.y * 0.5 + 0.5, 0.35));
	petalCol *= vec3(1.0, grady, grady);
	petalCol *= mix(0.9, 1.0, pow(abs(coord.x), 1.0));
	petalCol = petalCol * diffuse + specular;
	petalCol = mix(fadeCol, petalCol, distancefade);

	vec3 col;
	float alpha;

	if(r > rstop) {
		// 光晕区：从花瓣色渐变到光晕色
		float t = clamp((-r_glow) / 0.55, 0.0, 1.0);
		col = mix(petalCol * 0.4, uThemeColor.rgb, t);
		alpha = (1.0 - t * 0.85) * palpha * distancefade;
	} else {
		// 花瓣本体
		col = petalCol * uThemeColor.a;
		float edgeAlpha = (rstop > 0.001)? (0.5 - r / (rstop * 2.0)) : 1.0;
		alpha = smoothstep(0.0, 1.0, edgeAlpha) * palpha;
	}
	gl_FragColor = vec4(col, alpha);
}`;

const FX_COMMON_VSH = `
uniform vec3 uResolution;
attribute vec2 aPosition;
varying vec2 texCoord;
varying vec2 screenCoord;
void main(void) {
	gl_Position = vec4(aPosition, 0.0, 1.0);
	texCoord = aPosition.xy * 0.5 + vec2(0.5, 0.5);
	screenCoord = aPosition.xy * vec2(uResolution.z, 1.0);
}`;

const FX_BRIGHTBUF_FSH = `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D uSrc;
uniform vec2 uDelta;
varying vec2 texCoord;
varying vec2 screenCoord;
void main(void) {
	vec4 col = texture2D(uSrc, texCoord);
	gl_FragColor = vec4(col.rgb * 2.0 - vec3(0.5), 1.0);
}`;

const FX_DIRBLUR_R4_FSH = `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D uSrc;
uniform vec2 uDelta;
uniform vec4 uBlurDir;
varying vec2 texCoord;
varying vec2 screenCoord;
void main(void) {
	vec4 col = texture2D(uSrc, texCoord);
	col = col + texture2D(uSrc, texCoord + uBlurDir.xy * uDelta);
	col = col + texture2D(uSrc, texCoord - uBlurDir.xy * uDelta);
	col = col + texture2D(uSrc, texCoord + (uBlurDir.xy + uBlurDir.zw) * uDelta);
	col = col + texture2D(uSrc, texCoord - (uBlurDir.xy + uBlurDir.zw) * uDelta);
	gl_FragColor = col / 7.5;
}`;

const PP_FINAL_VSH = `
uniform vec3 uResolution;
attribute vec2 aPosition;
varying vec2 texCoord;
varying vec2 screenCoord;
void main(void) {
	gl_Position = vec4(aPosition, 0.0, 1.0);
	texCoord = aPosition.xy * 0.5 + vec2(0.5, 0.5);
	screenCoord = aPosition.xy * vec2(uResolution.z, 1.0);
}`;

const PP_FINAL_FSH = `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform vec2 uDelta;
varying vec2 texCoord;
varying vec2 screenCoord;
void main(void) {
	vec4 srccol = texture2D(uSrc, texCoord) * 2.0;
	vec4 bloomcol = texture2D(uBloom, texCoord);
	vec4 col = srccol + bloomcol * (vec4(1.0) + srccol);
	col = pow(col, vec4(0.45454545454545));
	gl_FragColor = vec4(col.rgb, srccol.a);
}`;

// ====== 粒子 & Shader 类型 ======

interface RenderTarget {
	width: number;
	height: number;
	sizeArray: Float32Array;
	dtxArray: Float32Array;
	frameBuffer: WebGLFramebuffer | null;
	renderBuffer: WebGLRenderbuffer | null;
	texture: WebGLTexture | null;
}

interface ShaderProgram {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
	attributes: Record<string, number>;
}

interface FxProgram {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
	attributes: Record<string, number>;
	dataArray: Float32Array;
	buffer: WebGLBuffer | null;
}

class BlossomParticle {
	velocity = new Array(3).fill(0);
	rotation = new Array(3).fill(0);
	position = new Array(3).fill(0);
	euler = new Array(3).fill(0);
	size = 1.0;
	alpha = 1.0;
	zkey = 0.0;

	setVelocity(vx: number, vy: number, vz: number) { this.velocity = [vx, vy, vz]; }
	setRotation(rx: number, ry: number, rz: number) { this.rotation = [rx, ry, rz]; }
	setPosition(nx: number, ny: number, nz: number) { this.position = [nx, ny, nz]; }
	setEulerAngles(rx: number, ry: number, rz: number) { this.euler = [rx, ry, rz]; }
	setSize(s: number) { this.size = s; }

	update(dt: number) {
		this.position[0] += this.velocity[0] * dt;
		this.position[1] += this.velocity[1] * dt;
		this.position[2] += this.velocity[2] * dt;
		this.euler[0] += this.rotation[0] * dt;
		this.euler[1] += this.rotation[1] * dt;
		this.euler[2] += this.rotation[2] * dt;
	}
}

// ====== 主效果类 ======

export class SakuraEffect {
	private canvas: HTMLCanvasElement | null = null;
	private gl: WebGLRenderingContext | null = null;
	private animFrameId: number | null = null;
	private active = false;

	// 渲染状态
	private renderSpec = {
		width: 0, height: 0, aspect: 1,
		array: new Float32Array(3),
		halfWidth: 0, halfHeight: 0,
		halfArray: new Float32Array(3),
		pointSize: { min: 0, max: 0 },
		mainRT: null as RenderTarget | null,
		wFullRT0: null as RenderTarget | null,
		wFullRT1: null as RenderTarget | null,
		wHalfRT0: null as RenderTarget | null,
		wHalfRT1: null as RenderTarget | null,
		setSize(w: number, h: number) {
			this.width = w; this.height = h;
			this.aspect = w / h;
			this.array[0] = w; this.array[1] = h; this.array[2] = this.aspect;
			this.halfWidth = Math.floor(w / 2);
			this.halfHeight = Math.floor(h / 2);
			this.halfArray[0] = this.halfWidth;
			this.halfArray[1] = this.halfHeight;
			this.halfArray[2] = this.halfWidth / this.halfHeight;
		},
	};

	private timeInfo = { start: 0, prev: 0, delta: 0, elapsed: 0 };
	private sceneStandBy = false;

	// 3D 场景
	private projection = { angle: 60, nearfar: new Float32Array([0.1, 100.0]), matrix: Mat4.createIdentity() };
	private camera = {
		position: Vec3.create(0, 0, 100),
		lookat: Vec3.create(0, 0, 0),
		up: Vec3.create(0, 1, 0),
		dof: Vec3.create(10.0, 4.0, 8.0),
		matrix: Mat4.createIdentity(),
	};

	// 粒子系统
	private pointFlower: any = {};
	// 特效
	private effectLib: Record<string, FxProgram> = {};

	// 绑定的事件处理
	private resizeBound = () => this.onResize();

	// ====== WebGL 工具方法 ======

	private createShader(shtype: number, shsrc: string): WebGLShader | null {
		const gl = this.gl!;
		const sh = gl.createShader(shtype)!;
		gl.shaderSource(sh, shsrc);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			console.error('SakuraEffect shader compile error:', gl.getShaderInfoLog(sh));
			gl.deleteShader(sh);
			return null;
		}
		return sh;
	}

	private createProgram(vtxsrc: string, frgsrc: string, uniformlist?: string[], attrlist?: string[]): ShaderProgram | null {
		const gl = this.gl!;
		const vsh = this.createShader(gl.VERTEX_SHADER, vtxsrc);
		const fsh = this.createShader(gl.FRAGMENT_SHADER, frgsrc);
		if (!vsh || !fsh) return null;

		const prog = gl.createProgram()!;
		gl.attachShader(prog, vsh);
		gl.attachShader(prog, fsh);
		gl.deleteShader(vsh);
		gl.deleteShader(fsh);
		gl.linkProgram(prog);

		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.error('SakuraEffect link error:', gl.getProgramInfoLog(prog));
			return null;
		}

		const result: ShaderProgram = { program: prog, uniforms: {}, attributes: {} };
		if (uniformlist) {
			for (const u of uniformlist) {
				result.uniforms[u] = gl.getUniformLocation(prog, u);
			}
		}
		if (attrlist) {
			for (const a of attrlist) {
				result.attributes[a] = gl.getAttribLocation(prog, a);
			}
		}
		return result;
	}

	private useProgram(prog: ShaderProgram) {
		const gl = this.gl!;
		gl.useProgram(prog.program);
		for (const attr in prog.attributes) {
			gl.enableVertexAttribArray(prog.attributes[attr]);
		}
	}

	private unuseProgram(prog: ShaderProgram) {
		const gl = this.gl!;
		for (const attr in prog.attributes) {
			gl.disableVertexAttribArray(prog.attributes[attr]);
		}
		gl.useProgram(null);
	}

	private deleteRenderTarget(rt: RenderTarget) {
		const gl = this.gl!;
		if (rt.frameBuffer) gl.deleteFramebuffer(rt.frameBuffer);
		if (rt.renderBuffer) gl.deleteRenderbuffer(rt.renderBuffer);
		if (rt.texture) gl.deleteTexture(rt.texture);
	}

	private createRenderTarget(w: number, h: number): RenderTarget {
		const gl = this.gl!;
		const ret: RenderTarget = {
			width: w, height: h,
			sizeArray: new Float32Array([w, h, w / h]),
			dtxArray: new Float32Array([1.0 / w, 1.0 / h]),
			frameBuffer: gl.createFramebuffer(),
			renderBuffer: gl.createRenderbuffer(),
			texture: gl.createTexture(),
		};

		gl.bindTexture(gl.TEXTURE_2D, ret.texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

		gl.bindFramebuffer(gl.FRAMEBUFFER, ret.frameBuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ret.texture, 0);

		gl.bindRenderbuffer(gl.RENDERBUFFER, ret.renderBuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, ret.renderBuffer);

		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindRenderbuffer(gl.RENDERBUFFER, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		return ret;
	}

	// ====== 特效程序 ======

	private createEffectProgram(vtxsrc: string, frgsrc: string, exunifs?: string[], exattrs?: string[]): FxProgram {
		const gl = this.gl!;
		const unifs = ['uResolution', 'uSrc', 'uDelta'];
		if (exunifs) unifs.push(...exunifs);
		const attrs = ['aPosition'];
		if (exattrs) attrs.push(...exattrs);

		const prog = this.createProgram(vtxsrc, frgsrc, unifs, attrs)!;
		this.useProgram(prog);

		const dataArray = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, dataArray, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.unuseProgram(prog);

		return { ...prog, dataArray, buffer };
	}

	private useEffect(fxobj: FxProgram, srctex: RenderTarget | null) {
		const gl = this.gl!;
		const prog = fxobj.program;
		gl.useProgram(prog);
		for (const attr in fxobj.attributes) {
			gl.enableVertexAttribArray(fxobj.attributes[attr]);
		}
		gl.uniform3fv(fxobj.uniforms.uResolution, this.renderSpec.array);
		if (srctex) {
			gl.uniform2fv(fxobj.uniforms.uDelta, srctex.dtxArray);
			gl.uniform1i(fxobj.uniforms.uSrc, 0);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, srctex.texture);
		}
	}

	private drawEffect(fxobj: FxProgram) {
		const gl = this.gl!;
		gl.bindBuffer(gl.ARRAY_BUFFER, fxobj.buffer);
		gl.vertexAttribPointer(fxobj.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	private unuseEffect(fxobj: FxProgram) {
		const gl = this.gl!;
		for (const attr in fxobj.attributes) {
			gl.disableVertexAttribArray(fxobj.attributes[attr]);
		}
		gl.useProgram(null);
	}

	// ====== 场景创建 ======

	private setViewports() {
		const gl = this.gl!;
		this.renderSpec.setSize(gl.canvas.width, gl.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.viewport(0, 0, this.renderSpec.width, this.renderSpec.height);

		const rtfunc = (rtname: 'mainRT' | 'wFullRT0' | 'wFullRT1' | 'wHalfRT0' | 'wHalfRT1', rtw: number, rth: number) => {
			if (this.renderSpec[rtname]) this.deleteRenderTarget(this.renderSpec[rtname]!);
			this.renderSpec[rtname] = this.createRenderTarget(rtw, rth);
		};
		rtfunc('mainRT', this.renderSpec.width, this.renderSpec.height);
		rtfunc('wFullRT0', this.renderSpec.width, this.renderSpec.height);
		rtfunc('wFullRT1', this.renderSpec.width, this.renderSpec.height);
		rtfunc('wHalfRT0', this.renderSpec.halfWidth, this.renderSpec.halfHeight);
		rtfunc('wHalfRT1', this.renderSpec.halfWidth, this.renderSpec.halfHeight);
	}

	private createEffectLib() {
		this.effectLib.mkBrightBuf = this.createEffectProgram(FX_COMMON_VSH, FX_BRIGHTBUF_FSH);
		this.effectLib.dirBlur = this.createEffectProgram(FX_COMMON_VSH, FX_DIRBLUR_R4_FSH, ['uBlurDir']);
		this.effectLib.finalComp = this.createEffectProgram(PP_FINAL_VSH, PP_FINAL_FSH, ['uBloom']);
	}

	private createPointFlowers() {
		const gl = this.gl!;
		const prm = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
		this.renderSpec.pointSize = { min: prm[0], max: prm[1] };

		const prog = this.createProgram(SAKURA_POINT_VSH, SAKURA_POINT_FSH,
			['uProjection', 'uModelview', 'uResolution', 'uOffset', 'uDOF', 'uFade', 'uThemeColor'],
			['aPosition', 'aEuler', 'aMisc'])!;

		this.useProgram(prog);
		this.pointFlower.program = prog;
		this.pointFlower.offset = new Float32Array([0, 0, 0]);
		this.pointFlower.fader = Vec3.create(0, 10, 0);
		this.pointFlower.numFlowers = 300;
		this.pointFlower.particles = new Array(300);
		this.pointFlower.dataArray = new Float32Array(300 * 8);
		this.pointFlower.positionArrayOffset = 0;
		this.pointFlower.eulerArrayOffset = 300 * 3;
		this.pointFlower.miscArrayOffset = 300 * 6;
		this.pointFlower.buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.pointFlower.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.pointFlower.dataArray, gl.DYNAMIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.unuseProgram(prog);

		for (let i = 0; i < 300; i++) {
			this.pointFlower.particles[i] = new BlossomParticle();
		}
	}

	private initPointFlowers() {
		this.pointFlower.area = Vec3.create(20, 20, 20);
		this.pointFlower.area.x = this.pointFlower.area.y * this.renderSpec.aspect;
		this.pointFlower.fader.x = 10;
		this.pointFlower.fader.y = this.pointFlower.area.z;
		this.pointFlower.fader.z = 0.1;

		const PI2 = Math.PI * 2;
		const tmpv3 = Vec3.create(0, 0, 0);
		const symmetryrand = () => Math.random() * 2 - 1;

		for (let i = 0; i < this.pointFlower.numFlowers; i++) {
			const p = this.pointFlower.particles[i];
			tmpv3.x = symmetryrand() * 0.3 - 0.8;
			tmpv3.y = symmetryrand() * 0.2 - 1.0;
			tmpv3.z = symmetryrand() * 0.3 - 0.5;
			Vec3.normalize(tmpv3);
			const tmpv = 2.0 + Math.random();
			p.setVelocity(tmpv3.x * tmpv, tmpv3.y * tmpv, tmpv3.z * tmpv);
			p.setRotation(symmetryrand() * PI2 * 0.5, symmetryrand() * PI2 * 0.5, symmetryrand() * PI2 * 0.5);
			p.setPosition(
				symmetryrand() * this.pointFlower.area.x,
				symmetryrand() * this.pointFlower.area.y,
				symmetryrand() * this.pointFlower.area.z,
			);
			p.setEulerAngles(Math.random() * PI2, Math.random() * PI2, Math.random() * PI2);
			p.setSize(0.9 + Math.random() * 0.1);
		}
	}

	private renderPointFlowers() {
		const gl = this.gl!;
		const PI2 = Math.PI * 2;
		const pf = this.pointFlower;
		const limit = [pf.area.x, pf.area.y, pf.area.z];

		for (let i = 0; i < pf.numFlowers; i++) {
			const p = pf.particles[i];
			p.update(this.timeInfo.delta);
			// Wrap positions
			for (let c = 0; c < 3; c++) {
				if (Math.abs(p.position[c]) - p.size * 0.5 > limit[c]) {
					p.position[c] += (p.position[c] > 0 ? -1 : 1) * limit[c] * 2;
				}
			}
			for (let c = 0; c < 3; c++) {
				p.euler[c] = p.euler[c] % PI2;
				if (p.euler[c] < 0) p.euler[c] += PI2;
			}
			p.alpha = 1.0;
			const cm = this.camera.matrix;
			p.zkey = cm[2] * p.position[0] + cm[6] * p.position[1] + cm[10] * p.position[2] + cm[14];
		}

		pf.particles.sort((a: BlossomParticle, b: BlossomParticle) => a.zkey - b.zkey);

		let ipos = pf.positionArrayOffset;
		let ieuler = pf.eulerArrayOffset;
		let imisc = pf.miscArrayOffset;
		for (let i = 0; i < pf.numFlowers; i++) {
			const p = pf.particles[i];
			pf.dataArray[ipos] = p.position[0];
			pf.dataArray[ipos + 1] = p.position[1];
			pf.dataArray[ipos + 2] = p.position[2];
			ipos += 3;
			pf.dataArray[ieuler] = p.euler[0];
			pf.dataArray[ieuler + 1] = p.euler[1];
			pf.dataArray[ieuler + 2] = p.euler[2];
			ieuler += 3;
			pf.dataArray[imisc] = p.size;
			pf.dataArray[imisc + 1] = p.alpha;
			imisc += 2;
		}

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		const prog = pf.program as ShaderProgram;
		this.useProgram(prog);
		gl.uniformMatrix4fv(prog.uniforms.uProjection, false, this.projection.matrix);
		gl.uniformMatrix4fv(prog.uniforms.uModelview, false, this.camera.matrix);
		gl.uniform3fv(prog.uniforms.uResolution, this.renderSpec.array);
		gl.uniform3fv(prog.uniforms.uDOF, Vec3.arrayForm(this.camera.dof));
		gl.uniform3fv(prog.uniforms.uFade, Vec3.arrayForm(pf.fader));

		const isDark = document.body.classList.contains('theme-dark');
		gl.uniform4f(prog.uniforms.uThemeColor,
			isDark ? 0.03 : 0.012, isDark ? 0.015 : 0.005, isDark ? 0.06 : 0.03,  // glow RGB
			isDark ? 0.8 : 1.8   // brightness
		);

		gl.bindBuffer(gl.ARRAY_BUFFER, pf.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, pf.dataArray, gl.DYNAMIC_DRAW);
		const F32 = Float32Array.BYTES_PER_ELEMENT;
		gl.vertexAttribPointer(prog.attributes.aPosition, 3, gl.FLOAT, false, 0, pf.positionArrayOffset * F32);
		gl.vertexAttribPointer(prog.attributes.aEuler, 3, gl.FLOAT, false, 0, pf.eulerArrayOffset * F32);
		gl.vertexAttribPointer(prog.attributes.aMisc, 2, gl.FLOAT, false, 0, pf.miscArrayOffset * F32);

		// 9个实例 (3x3 网格)
		for (let i = 1; i < 2; i++) {
			const zpos = i * -2;
			const offsets: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
			for (const [sx, sy] of offsets) {
				pf.offset[0] = pf.area.x * sx;
				pf.offset[1] = pf.area.y * sy;
				pf.offset[2] = pf.area.z * zpos;
				gl.uniform3fv(prog.uniforms.uOffset, pf.offset);
				gl.drawArrays(gl.POINTS, 0, pf.numFlowers);
			}
		}
		pf.offset[0] = 0; pf.offset[1] = 0; pf.offset[2] = 0;
		gl.uniform3fv(prog.uniforms.uOffset, pf.offset);
		gl.drawArrays(gl.POINTS, 0, pf.numFlowers);

		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.unuseProgram(prog);
		gl.enable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
	}

	private renderPostProcess() {
		const gl = this.gl!;
		gl.enable(gl.TEXTURE_2D);
		gl.disable(gl.DEPTH_TEST);

		const bindRT = (rt: RenderTarget, isclear: boolean) => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, rt.frameBuffer);
			gl.viewport(0, 0, rt.width, rt.height);
			if (isclear) {
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			}
		};

		// Bright buffer
		bindRT(this.renderSpec.wHalfRT0!, true);
		this.useEffect(this.effectLib.mkBrightBuf, this.renderSpec.mainRT);
		this.drawEffect(this.effectLib.mkBrightBuf);
		this.unuseEffect(this.effectLib.mkBrightBuf);

		// Directional blur (2 passes)
		for (let i = 0; i < 2; i++) {
			const p = 1.5 + i;
			const s = 2.0 + i;
			bindRT(this.renderSpec.wHalfRT1!, true);
			this.useEffect(this.effectLib.dirBlur, this.renderSpec.wHalfRT0);
			gl.uniform4f(this.effectLib.dirBlur.uniforms.uBlurDir, p, 0, s, 0);
			this.drawEffect(this.effectLib.dirBlur);
			this.unuseEffect(this.effectLib.dirBlur);

			bindRT(this.renderSpec.wHalfRT0!, true);
			this.useEffect(this.effectLib.dirBlur, this.renderSpec.wHalfRT1);
			gl.uniform4f(this.effectLib.dirBlur.uniforms.uBlurDir, 0, p, 0, s);
			this.drawEffect(this.effectLib.dirBlur);
			this.unuseEffect(this.effectLib.dirBlur);
		}

		// Final composite
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.renderSpec.width, this.renderSpec.height);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		this.useEffect(this.effectLib.finalComp, this.renderSpec.mainRT);
		gl.uniform1i(this.effectLib.finalComp.uniforms.uBloom, 1);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.renderSpec.wHalfRT0!.texture);
		this.drawEffect(this.effectLib.finalComp);
		this.unuseEffect(this.effectLib.finalComp);

		gl.enable(gl.DEPTH_TEST);
	}

	private createScene() {
		this.createEffectLib();
		this.createPointFlowers();
		this.sceneStandBy = true;
	}

	private initScene() {
		this.initPointFlowers();
		this.camera.position.z = this.pointFlower.area.z + this.projection.nearfar[0];
		this.projection.angle = Math.atan2(this.pointFlower.area.y, this.camera.position.z + this.pointFlower.area.z) * 180 / Math.PI * 2;
		Mat4.loadProjection(this.projection.matrix, this.renderSpec.aspect, this.projection.angle, this.projection.nearfar[0], this.projection.nearfar[1]);
	}

	private renderScene() {
		const gl = this.gl!;
		Mat4.loadLookAt(this.camera.matrix, this.camera.position, this.camera.lookat, this.camera.up);
		gl.enable(gl.DEPTH_TEST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderSpec.mainRT!.frameBuffer);
		gl.viewport(0, 0, this.renderSpec.mainRT!.width, this.renderSpec.mainRT!.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.renderPointFlowers();
		this.renderPostProcess();
	}

	private onResize() {
		if (!this.canvas) return;
		this.makeCanvasFullScreen();
		this.setViewports();
		if (this.sceneStandBy) {
			this.initScene();
		}
	}

	private makeCanvasFullScreen() {
		if (!this.canvas) return;
		const b = document.body;
		const d = document.documentElement;
		const fullw = Math.max(b.clientWidth, b.scrollWidth, d.scrollWidth, d.clientWidth);
		const fullh = Math.max(b.clientHeight, b.scrollHeight, d.scrollHeight, d.clientHeight);
		this.canvas.width = fullw;
		this.canvas.height = fullh;
	}

	private animate = () => {
		if (!this.active) return;
		const curdate = Date.now();
		this.timeInfo.elapsed = (curdate - this.timeInfo.start) / 1000;
		this.timeInfo.delta = (curdate - this.timeInfo.prev) / 1000;
		this.timeInfo.prev = curdate;
		this.renderScene();
		this.animFrameId = requestAnimationFrame(this.animate);
	};

	// ====== 公开 API ======

	/**
	 * 启动樱花效果
	 */
	public start(): void {
		if (this.active) return;
		this.active = true;

		this.canvas = document.createElement('canvas');
		this.canvas.classList.add('minidoro-sakura-canvas');
		this.canvas.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			pointer-events: none;
			z-index: 0;
		`;
		document.body.appendChild(this.canvas);

		try {
			this.gl = this.canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
			if (!this.gl) throw new Error('WebGL not supported');
		} catch (e) {
			console.error('SakuraEffect: WebGL not supported', e);
			this.canvas.remove();
			this.canvas = null;
			this.active = false;
			return;
		}

		window.addEventListener('resize', this.resizeBound);

		this.makeCanvasFullScreen();
		this.setViewports();
		this.createScene();
		this.initScene();

		this.timeInfo.start = Date.now();
		this.timeInfo.prev = this.timeInfo.start;
		this.animate();
	}

	/**
	 * 停止樱花效果并清理
	 */
	public stop(): void {
		if (!this.active) return;
		this.active = false;

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		window.removeEventListener('resize', this.resizeBound);

		const gl = this.gl;
		if (gl) {
			['mainRT', 'wFullRT0', 'wFullRT1', 'wHalfRT0', 'wHalfRT1'].forEach(name => {
				const rt = (this.renderSpec as any)[name] as RenderTarget | null;
				if (rt) this.deleteRenderTarget(rt);
			});

			if (this.pointFlower.buffer) gl.deleteBuffer(this.pointFlower.buffer);

			const ext = gl.getExtension('WEBGL_lose_context');
			if (ext) ext.loseContext();
		}

		if (this.canvas) {
			this.canvas.remove();
			this.canvas = null;
		}

		this.gl = null;
		this.sceneStandBy = false;
		this.effectLib = {};
	}

	/**
	 * 获取当前激活状态
	 */
	public isActive(): boolean {
		return this.active;
	}
}