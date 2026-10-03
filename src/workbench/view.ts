import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type MasterpieceToolsPlugin from '../main';
import { WORKBENCH_CARDS } from './cards';
import type { CardRunResult, WorkbenchCard } from './card-types';
import { formatDateTime } from '../utils/format';
import { createIconButton } from './ui/controls';

export const WORKBENCH_VIEW_TYPE = 'masterpiece-workbench';

/** 卡片上次运行的结果，决定卡片左侧状态色轨 */
type RunState = 'idle' | 'ok' | 'error' | 'running';

/**
 * 工作台侧边栏：搜索栏 + 功能卡片列表。
 *
 * 布局原则：标题区回答「今天有什么要做」，卡片区的色轨回答「哪些跑过、结果如何」，
 * 两者都不靠装饰性的图标或文字标签来表达状态。
 */
export class WorkbenchView extends ItemView {
	plugin: MasterpieceToolsPlugin;

	/** 正在运行的卡片 ID */
	private running = new Set<string>();

	/** 搜索关键词，跨重新渲染保留 */
	private query = '';

	/** 标题区摘要，跨重新渲染保留，避免每次重绘都闪一下 */
	private heroText = '';

	private cardsEl: HTMLElement | null = null;
	private heroEl: HTMLElement | null = null;
	private announcerEl: HTMLElement | null = null;
	private announceTick = false;

	constructor(leaf: WorkspaceLeaf, plugin: MasterpieceToolsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return WORKBENCH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '工作台';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** 重新渲染整个视图 */
	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('masterpiece-workbench');

		this.renderHeader(contentEl);
		this.renderSearch(contentEl);

		this.cardsEl = contentEl.createDiv({ cls: 'mp-cards' });
		this.renderCards();

		contentEl.createDiv({
			cls: 'mp-footer',
			text: `${this.plugin.app.vault.getName()} · Masterpiece Tools v${this.plugin.manifest.version}`,
		});

		// 单一活动区域：运行结果统一在这里播报。
		// 不给每张卡片的状态行都挂 aria-live —— 那样会互相抢话，
		// 而且状态行本身重复渲染时还会被反复念。
		this.announcerEl = contentEl.createDiv({
			cls: 'mp-sr-only',
			attr: { 'aria-live': 'polite', 'aria-atomic': 'true' },
		});

		void this.refreshHero();
	}

	/* ── 标题区 ───────────────────────────────────────────── */

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'mp-header' });

		const top = header.createDiv({ cls: 'mp-header-top' });
		const iconEl = top.createDiv({ cls: 'mp-header-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(iconEl, 'layout-dashboard');
		top.createEl('h2', { cls: 'mp-header-title', text: '工作台' });

		// 首屏最该看到的是「今天有什么要做」。
		// 仓库名是用户已经知道的事实，挪到页脚当参考信息。
		this.heroEl = header.createDiv({
			cls: 'mp-header-hero',
			text: this.heroText || '正在统计待回看…',
		});
	}

	/**
	 * 统计今日待回看。读的是插件内存里的缓存，不会重复扫仓库；
	 * 失败时降级成一句说明，不把异常抛到界面上。
	 */
	private async refreshHero(): Promise<void> {
		const due = await this.plugin.getDueCount();

		this.heroText =
			due === null
				? '回看清单读取失败，打开回看卡片看详情'
				: due > 0
					? `今天 ${due} 篇待回看`
					: '今天没有待回看的笔记';

		const el = this.heroEl;
		if (!el || !el.isConnected) return;

		el.setText(this.heroText);
		el.removeClass('is-due', 'is-clear', 'is-error');
		el.addClass(due === null ? 'is-error' : due > 0 ? 'is-due' : 'is-clear');
	}

	/* ── 搜索栏 ───────────────────────────────────────────── */

	private renderSearch(container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: 'mp-search' });
		const searchIcon = wrapper.createDiv({
			cls: 'mp-search-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(searchIcon, 'search');

		const input = wrapper.createEl('input', {
			cls: 'mp-search-input',
			attr: {
				type: 'search',
				name: 'masterpiece-feature-search',
				// 非登录字段，关掉自动填充，避免密码管理器弹候选
				autocomplete: 'off',
				placeholder: '搜索功能…',
				'aria-label': '搜索工作台功能',
			},
		});
		input.value = this.query;

		const clear = createIconButton(wrapper, {
			icon: 'x',
			label: '清空搜索',
			cls: 'mp-search-clear',
			onClick: () => {
				this.query = '';
				input.value = '';
				clear.toggleClass('is-hidden', true);
				this.renderCards();
				input.focus();
			},
		});
		clear.toggleClass('is-hidden', this.query.trim().length === 0);

		input.addEventListener('input', () => {
			this.query = input.value;
			clear.toggleClass('is-hidden', this.query.trim().length === 0);
			// 只重绘列表，输入框的焦点不会丢
			this.renderCards();
		});
	}

	/* ── 卡片列表 ─────────────────────────────────────────── */

	/** 按关键词筛出卡片并渲染 */
	private renderCards(): void {
		const list = this.cardsEl;
		if (!list) return;

		list.empty();
		const matched = this.filterCards(this.query);

		if (matched.length === 0) {
			list.createDiv({
				cls: 'mp-empty',
				text: `没有匹配「${this.query.trim()}」的功能`,
			});
			return;
		}

		for (const card of matched) this.renderCard(list, card);
	}

	private filterCards(query: string): WorkbenchCard[] {
		const keyword = query.trim().toLowerCase();
		if (!keyword) return WORKBENCH_CARDS;

		return WORKBENCH_CARDS.filter((card) => {
			const haystack = [card.title, card.description, ...(card.keywords ?? [])]
				.join(' ')
				.toLowerCase();
			return haystack.includes(keyword);
		});
	}

	private runStateOf(card: WorkbenchCard): RunState {
		if (this.running.has(card.id)) return 'running';

		const record = this.plugin.settings.lastRuns[card.id];
		if (!record) return 'idle';
		return record.ok ? 'ok' : 'error';
	}

	private renderCard(container: HTMLElement, card: WorkbenchCard): void {
		if (card.render) this.renderFormCard(container, card);
		else this.renderActionCard(container, card);
	}

	/**
	 * 一键式卡片：整张卡就是一个原生 button。
	 *
	 * 原来是用挂了 click 的 div + role="button" + tabindex 手搓按钮，
	 * 那套写法在键盘和读屏下的行为全靠自己维护。原生 button 自带
	 * 键盘激活、焦点管理、禁用语义，能不做多余的 ARIA 就别做。
	 */
	private renderActionCard(container: HTMLElement, card: WorkbenchCard): void {
		const state = this.runStateOf(card);
		const titleId = `mp-card-title-${card.id}`;
		const descId = `mp-card-desc-${card.id}`;

		const cardEl = container.createEl('button', {
			cls: `mp-card is-${state}`,
			attr: {
				type: 'button',
				'aria-labelledby': titleId,
				'aria-describedby': descId,
			},
		});

		if (state === 'running') cardEl.setAttr('aria-busy', 'true');
		if (!card.available) {
			cardEl.disabled = true;
			cardEl.addClass('is-disabled');
		}

		const iconBox = cardEl.createSpan({
			cls: 'mp-card-icon',
			attr: { 'aria-hidden': 'true' },
		});
		// 记住原图标，运行结束要换回来
		iconBox.setAttr('data-mp-icon', card.icon);
		setIcon(iconBox, card.icon);

		const main = cardEl.createSpan({ cls: 'mp-card-main' });
		main.createSpan({ cls: 'mp-card-title', text: card.title, attr: { id: titleId } });
		main.createSpan({ cls: 'mp-card-desc', text: card.description, attr: { id: descId } });
		this.createStatusEl(main, card);

		// 悬停 / 聚焦时才出现的动作提示，替代原来每张卡片都挂一个的装饰箭头
		cardEl.createSpan({
			cls: 'mp-card-cue',
			text: '运行',
			attr: { 'aria-hidden': 'true' },
		});

		const run = card.run;
		if (!card.available || !run) return;

		cardEl.addEventListener('click', () => {
			const statusEl = cardEl.querySelector<HTMLElement>('.mp-card-status');
			void this.runExecutor(card.id, cardEl, statusEl, () => run(this.plugin));
		});
	}

	/**
	 * 带表单的卡片。卡片本身不可点（里面有输入控件），
	 * 所以标题用 h3 成为真正的段落标题，而不是按钮的文本。
	 */
	private renderFormCard(container: HTMLElement, card: WorkbenchCard): void {
		const state = this.runStateOf(card);
		const cardEl = container.createDiv({ cls: `mp-card is-form is-${state}` });

		const head = cardEl.createDiv({ cls: 'mp-card-head' });
		const iconBox = head.createDiv({
			cls: 'mp-card-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(iconBox, card.icon);

		const main = head.createDiv({ cls: 'mp-card-main' });
		main.createEl('h3', { cls: 'mp-card-title', text: card.title });
		main.createDiv({ cls: 'mp-card-desc', text: card.description });
		const statusEl = this.createStatusEl(main, card);

		const render = card.render;
		if (!render) return;

		const bodyEl = cardEl.createDiv({ cls: 'mp-card-body' });
		render(bodyEl, {
			plugin: this.plugin,
			run: (executor) => this.runExecutor(card.id, cardEl, statusEl, executor),
		});
	}

	/**
	 * 状态行始终创建（运行时要往里写），没有内容时用 is-blank 收起。
	 * 时间与消息分成两个元素：靠排版分层，不用「·」把信息串成一行。
	 */
	private createStatusEl(parent: HTMLElement, card: WorkbenchCard): HTMLElement {
		const el = parent.createSpan({ cls: 'mp-card-status' });
		const record = this.plugin.settings.lastRuns[card.id];

		if (record) {
			this.writeStatus(el, record.time, record.message, record.ok);
			return el;
		}

		if (card.badge) {
			el.setText(card.badge);
			el.addClass('is-muted');
			return el;
		}

		el.addClass('is-blank');
		return el;
	}

	private writeStatus(
		el: HTMLElement,
		time: number,
		message: string,
		ok: boolean,
	): void {
		el.empty();
		el.removeClass('is-muted', 'is-blank');
		el.addClass(ok ? 'is-ok' : 'is-error');
		el.createSpan({ cls: 'mp-card-time', text: formatDateTime(time) });
		el.createSpan({ cls: 'mp-card-message', text: message });
	}

	/* ── 执行 ─────────────────────────────────────────────── */

	/**
	 * 统一的执行入口：置运行态、执行、更新状态行。
	 * 简单卡片和自定义卡片都走这里，保证行为一致。
	 */
	private async runExecutor(
		cardId: string,
		cardEl: HTMLElement,
		statusEl: HTMLElement | null,
		executor: () => Promise<CardRunResult>,
	): Promise<CardRunResult | null> {
		// 已经在跑就忽略：改名、捕获这类操作重复执行会留下真后果
		if (this.running.has(cardId)) return null;

		this.running.add(cardId);
		cardEl.addClass('is-running');
		cardEl.removeClass('is-idle', 'is-ok', 'is-error');
		cardEl.setAttr('aria-busy', 'true');

		const iconEl = cardEl.querySelector<HTMLElement>('.mp-card-icon');
		const originalIcon = iconEl?.getAttr('data-mp-icon') ?? null;
		if (iconEl) {
			iconEl.empty();
			setIcon(iconEl, 'loader');
		}

		if (statusEl) {
			statusEl.empty();
			statusEl.removeClass('is-ok', 'is-error', 'is-muted', 'is-blank');
			statusEl.setText('运行中…');
		}

		try {
			const result = await this.plugin.executeCard(cardId, executor);
			this.applyOutcome(cardEl, statusEl, result.ok, result.message);
			this.announce(result.message);
			return result;
		} catch (error) {
			// executeCard 内部已经兜住了业务异常，走到这里的是写设置失败之类的意外
			console.error('[Masterpiece Tools] 卡片执行失败', error);
			const message = `运行失败：${(error as Error).message}`;
			this.applyOutcome(cardEl, statusEl, false, message);
			this.announce(message);
			return null;
		} finally {
			this.running.delete(cardId);
			cardEl.removeClass('is-running');
			cardEl.removeAttribute('aria-busy');
			if (iconEl && originalIcon) {
				iconEl.empty();
				setIcon(iconEl, originalIcon);
			}
		}
	}

	private applyOutcome(
		cardEl: HTMLElement,
		statusEl: HTMLElement | null,
		ok: boolean,
		message: string,
	): void {
		if (statusEl?.isConnected) this.writeStatus(statusEl, Date.now(), message, ok);
		cardEl.removeClass('is-idle', 'is-ok', 'is-error');
		cardEl.addClass(ok ? 'is-ok' : 'is-error');
	}

	/**
	 * 把结果推给单一活动区域。
	 * 末尾交替加一个零宽字符，保证「重复的同一句结果」也会被重新播报 ——
	 * 活动区域只在内容真的变化时才会念。
	 */
	private announce(message: string): void {
		const el = this.announcerEl;
		if (!el) return;
		this.announceTick = !this.announceTick;
		el.setText(this.announceTick ? `${message}\u200B` : message);
	}
}
