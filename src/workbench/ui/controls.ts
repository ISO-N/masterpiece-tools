import { setIcon } from 'obsidian';

/**
 * 工作台里复用的交互控件。
 *
 * 这里的存在理由：交互元素用原生语义元素（button）而不是挂了 click 的 div。
 * div + click 的写法在鼠标下看不出问题，但 Tab 走不到、键盘敲不动、
 * 屏幕阅读器也不知道那是个可操作的东西。
 */

/* ── 笔记链接 ─────────────────────────────────────────────── */

export interface NoteLinkOptions {
	/** 显示文本，通常是笔记名 */
	name: string;
	/** 完整路径，作为 tooltip，顺便解决同名笔记分不清的问题 */
	path: string;
	onOpen: () => void;
}

/**
 * 可点击的笔记名。
 * 键盘可达、Enter / Space 原生生效，无障碍名称直接取自按钮文本。
 */
export function createNoteLink(
	parent: HTMLElement,
	options: NoteLinkOptions,
): HTMLButtonElement {
	const el = parent.createEl('button', {
		cls: 'mp-note-link',
		text: options.name,
		attr: {
			type: 'button',
			title: options.path,
			// 文件名是标识符。浏览器自动翻译会把路径串改得面目全非，
			// 所以明确禁止翻译这一块。
			translate: 'no',
		},
	});
	el.addEventListener('click', options.onOpen);
	return el;
}

/* ── 图标按钮 ─────────────────────────────────────────────── */

export interface IconButtonOptions {
	icon: string;
	/** 无障碍名称。图标本身不传达信息，必须给文字标签 */
	label: string;
	cls: string;
	onClick: () => void;
}

/**
 * 只有图标的按钮。label 是必填的 ——
 * 一个没有无障碍名称的图标按钮，对屏幕阅读器用户等于不存在。
 */
export function createIconButton(
	parent: HTMLElement,
	options: IconButtonOptions,
): HTMLButtonElement {
	const el = parent.createEl('button', {
		cls: options.cls,
		attr: {
			type: 'button',
			'aria-label': options.label,
			title: options.label,
		},
	});
	setIcon(el, options.icon);
	el.addEventListener('click', options.onClick);
	return el;
}

/* ── 计数标签 ─────────────────────────────────────────────── */

/**
 * 统一的计数标签：数字在前，标签在后。
 * 用它替代 "共 12 篇 · 进行中 5 · 暂停 2" 这种中缀圆点串 ——
 * 靠排版间距分组，比靠分隔符更容易扫读。
 */
export function createCount(
	parent: HTMLElement,
	value: number | string,
	label: string,
	cls?: string,
): HTMLElement {
	const el = parent.createSpan({ cls: cls ? `mp-count ${cls}` : 'mp-count' });
	el.createSpan({ cls: 'mp-count-value', text: String(value) });
	el.createSpan({ cls: 'mp-count-label', text: label });
	return el;
}

/* ── 折叠面板 ─────────────────────────────────────────────── */

export interface FoldOptions {
	title: string;
	open: boolean;
	/** 展开状态由调用方持有，这样重新渲染后折叠状态不会丢 */
	onToggle: (open: boolean) => void;
}

export interface Fold {
	root: HTMLElement;
	body: HTMLElement;
}

/**
 * 折叠面板。头部是原生 button 并带 aria-expanded ——
 * 「当前是展开还是收起」这个状态必须能被辅助技术读到，
 * 只靠一个箭头图标的方向是不够的。
 */
export function createFold(parent: HTMLElement, options: FoldOptions): Fold {
	const root = parent.createDiv({ cls: 'mp-fold' });
	const head = root.createEl('button', {
		cls: 'mp-fold-head',
		attr: { type: 'button' },
	});
	const icon = head.createSpan({ cls: 'mp-fold-icon', attr: { 'aria-hidden': 'true' } });
	head.createSpan({ text: options.title });
	const body = root.createDiv({ cls: 'mp-fold-body' });

	let open = options.open;

	const apply = (): void => {
		icon.empty();
		setIcon(icon, open ? 'chevron-down' : 'chevron-right');
		head.setAttr('aria-expanded', String(open));
		body.toggleClass('is-hidden', !open);
		root.toggleClass('is-open', open);
	};

	head.addEventListener('click', () => {
		open = !open;
		apply();
		options.onToggle(open);
	});

	apply();
	return { root, body };
}
