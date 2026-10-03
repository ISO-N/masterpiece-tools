import { ItemView, WorkspaceLeaf, moment, setIcon } from 'obsidian';
import type MasterpieceToolsPlugin from '../main';
import { WORKBENCH_CARDS } from './cards';
import type { CardRunResult, WorkbenchCard } from './card-types';

export const WORKBENCH_VIEW_TYPE = 'masterpiece-workbench';

/**
 * 工作台侧边栏：搜索栏 + 功能卡片列表。
 */
export class WorkbenchView extends ItemView {
	plugin: MasterpieceToolsPlugin;

	/** 正在运行的卡片 ID */
	private running = new Set<string>();

	/** 搜索关键词，跨重新渲染保留 */
	private query = '';

	private cardsEl: HTMLElement | null = null;

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
			text: `Masterpiece Tools v${this.plugin.manifest.version}`,
		});
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'mp-header' });
		const title = header.createDiv({ cls: 'mp-header-title' });
		const iconEl = title.createSpan({ cls: 'mp-header-icon' });
		setIcon(iconEl, 'layout-dashboard');
		title.createSpan({ text: '工作台' });
		header.createDiv({
			cls: 'mp-header-sub',
			text: `当前仓库 · ${this.plugin.app.vault.getName()}`,
		});
	}

	private renderSearch(container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: 'mp-search' });
		const searchIcon = wrapper.createSpan({ cls: 'mp-search-icon' });
		setIcon(searchIcon, 'search');

		const input = wrapper.createEl('input', {
			cls: 'mp-search-input',
			attr: {
				type: 'search',
				placeholder: '搜索功能',
				'aria-label': '搜索工作台功能',
			},
		});
		input.value = this.query;

		const clear = wrapper.createSpan({ cls: 'mp-search-clear' });
		setIcon(clear, 'x');
		clear.toggleClass('is-hidden', this.query.trim().length === 0);

		input.addEventListener('input', () => {
			this.query = input.value;
			clear.toggleClass('is-hidden', this.query.trim().length === 0);
			// 只重绘列表，输入框的焦点不会丢
			this.renderCards();
		});

		clear.addEventListener('click', () => {
			this.query = '';
			input.value = '';
			clear.addClass('is-hidden');
			this.renderCards();
			input.focus();
		});
	}

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

	private renderCard(container: HTMLElement, card: WorkbenchCard): void {
		const cardEl = container.createDiv({ cls: 'mp-card' });
		if (!card.available) cardEl.addClass('is-disabled');
		if (card.render) cardEl.addClass('is-custom');
		if (this.running.has(card.id)) cardEl.addClass('is-running');

		const iconBox = cardEl.createDiv({ cls: 'mp-card-icon' });
		setIcon(iconBox, card.icon);

		const main = cardEl.createDiv({ cls: 'mp-card-main' });
		main.createDiv({ cls: 'mp-card-title', text: card.title });
		main.createDiv({ cls: 'mp-card-desc', text: card.description });

		// 自定义卡片的表单区域，插在说明与状态行之间
		const bodyEl = card.render ? main.createDiv({ cls: 'mp-card-body' }) : null;

		const statusEl = main.createDiv({ cls: 'mp-card-status' });
		const record = this.plugin.settings.lastRuns[card.id];
		if (record) {
			statusEl.setText(
				`${moment(record.time).format('MM-DD HH:mm')} · ${record.message}`,
			);
			statusEl.addClass(record.ok ? 'is-ok' : 'is-error');
		} else {
			statusEl.setText(card.badge ?? (card.available ? '' : '开发中'));
			statusEl.addClass('is-muted');
		}

		const render = card.render;
		if (render && bodyEl) {
			render(bodyEl, {
				plugin: this.plugin,
				run: (executor) => this.runExecutor(card.id, cardEl, statusEl, executor),
			});
			return;
		}

		const action = cardEl.createDiv({ cls: 'mp-card-action' });
		setIcon(action, card.available ? 'arrow-up-right' : 'clock');

		const run = card.run;
		if (!card.available || !run) {
			cardEl.setAttr('aria-disabled', 'true');
			return;
		}

		cardEl.setAttr('role', 'button');
		cardEl.setAttr('tabindex', '0');
		cardEl.setAttr('aria-label', card.title);

		const trigger = () => {
			action.empty();
			setIcon(action, 'loader');
			void this.runExecutor(card.id, cardEl, statusEl, () =>
				run(this.plugin),
			).finally(() => {
				action.empty();
				setIcon(action, 'arrow-up-right');
			});
		};
		cardEl.addEventListener('click', trigger);
		cardEl.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				trigger();
			}
		});
	}

	/**
	 * 统一的执行入口：置运行态、执行、更新状态行。
	 * 简单卡片和自定义卡片都走这里，保证行为一致。
	 */
	private async runExecutor(
		cardId: string,
		cardEl: HTMLElement,
		statusEl: HTMLElement,
		executor: () => Promise<CardRunResult>,
	): Promise<CardRunResult | null> {
		if (this.running.has(cardId)) return null;

		this.running.add(cardId);
		cardEl.addClass('is-running');
		statusEl.removeClass('is-ok', 'is-error', 'is-muted');
		statusEl.setText('运行中…');

		try {
			const result = await this.plugin.executeCard(cardId, executor);
			if (statusEl.isConnected) {
				statusEl.setText(`${moment().format('MM-DD HH:mm')} · ${result.message}`);
				statusEl.addClass(result.ok ? 'is-ok' : 'is-error');
			}
			return result;
		} finally {
			this.running.delete(cardId);
			cardEl.removeClass('is-running');
		}
	}
}
