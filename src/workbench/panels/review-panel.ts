import { setIcon } from 'obsidian';
import type { CardActions } from '../card-types';
import {
	addPaths,
	applyReview,
	basenameOf,
	collectDue,
	collectManaged,
	createEmptyReviewFile,
	formatDay,
	ongoingIntervalOf,
	removeItem,
	restartItem,
	searchCandidates,
	setPaused,
	todayKey,
	type DueItem,
	type ManagedGroups,
	type ManagedItem,
	type ReviewFile,
} from '../../features/review';

/**
 * 回看提醒面板。
 *
 * 只读仓库、只写 .masterpiece/review.json，不对任何笔记做修改。
 */
export function mountReviewPanel(container: HTMLElement, actions: CardActions): void {
	const root = container.createDiv({ cls: 'mp-review' });
	const warningEl = root.createDiv({ cls: 'mp-review-warning' });
	const summaryEl = root.createDiv({ cls: 'mp-review-summary' });
	const dueEl = root.createDiv({ cls: 'mp-review-due' });
	const addEl = root.createDiv({ cls: 'mp-review-add' });
	const manageEl = root.createDiv({ cls: 'mp-review-manage' });

	const plugin = actions.plugin;
	const now = () => todayKey();

	let file: ReviewFile = createEmptyReviewFile();
	let warning: string | null = null;
	let loaded = false;
	let search = '';
	const openFolds = new Set<string>();

	const vaultPaths = (): string[] =>
		plugin.app.vault
			.getFiles()
			.filter((item) => item.extension === 'md')
			.map((item) => item.path);

	/* ── 数据 ─────────────────────────────────────────────── */

	async function persist(next: ReviewFile): Promise<void> {
		file = next;
		try {
			await plugin.saveReviewData(next);
			warning = null;
		} catch (error) {
			warning = `写入复习进度失败：${(error as Error).message}`;
		}
		render();
	}

	async function bootstrap(): Promise<void> {
		const result = await plugin.getReviewData();
		file = result.file;
		warning = result.warning;
		loaded = true;
		render();
	}

	/* ── 渲染 ─────────────────────────────────────────────── */

	function render(): void {
		renderWarning();
		renderSummary();
		renderDue();
		renderResults();
		renderManage();
	}

	function renderWarning(): void {
		warningEl.empty();
		warningEl.toggleClass('is-hidden', !warning);
		if (warning) warningEl.setText(warning);
	}

	function renderSummary(): void {
		summaryEl.empty();
		if (!loaded) {
			summaryEl.setText('读取中…');
			return;
		}

		const today = now();
		const due = collectDue(file, today);
		const overdue = due.filter((item) => item.overdueDays > 0).length;
		const groups = collectManaged(file);
		const total = Object.values(file.items).length;

		const headline = summaryEl.createDiv({ cls: 'mp-review-headline' });
		if (due.length === 0) {
			headline.setText(`${formatDay(today)} · 今天没有需要回看的笔记`);
			headline.addClass('is-clear');
		} else {
			headline.setText(
				`${formatDay(today)} · 待回看 ${due.length} 篇${overdue > 0 ? `（逾期 ${overdue} 篇）` : ''}`,
			);
			headline.addClass('is-due');
		}

		if (total === 0) {
			summaryEl.createDiv({
				cls: 'mp-review-counts',
				text: '回看清单还是空的，用下面的搜索框把笔记加进来。',
			});
			return;
		}

		const parts = [`进行中 ${groups.active.length + groups.ongoing.length}`];
		if (groups.paused.length > 0) parts.push(`暂停 ${groups.paused.length}`);
		if (groups.graduated.length > 0) parts.push(`已毕业 ${groups.graduated.length}`);
		if (groups.missing.length > 0) parts.push(`失联 ${groups.missing.length}`);
		summaryEl.createDiv({
			cls: 'mp-review-counts',
			text: `共 ${total} 篇 · ${parts.join(' · ')}`,
		});
	}

	function renderDue(): void {
		dueEl.empty();
		if (!loaded) return;

		const due = collectDue(file, now());
		if (due.length === 0) return;

		for (const item of due) buildDueRow(dueEl, item);
	}

	function buildDueRow(parent: HTMLElement, item: DueItem): HTMLElement {
		const row = parent.createDiv({ cls: 'mp-review-row' });

		const main = row.createDiv({ cls: 'mp-review-row-main' });
		const nameEl = main.createDiv({ cls: 'mp-review-row-name' });
		nameEl.setText(item.name);
		nameEl.addEventListener('click', () => {
			void openNote(item.path);
		});

		const ongoing = item.record.state === 'ongoing';
		const meta = ongoing
			? `常态回看 · 已完成 ${item.record.reviews} 次`
			: `第 ${item.round} 次 / 共 ${item.totalRounds} 次`;
		const overdueText =
			item.overdueDays > 0 ? `逾期 ${item.overdueDays} 天` : '今天到期';
		const hint = item.needsChoice && !ongoing ? ' · 计划内最后一次' : '';

		main.createDiv({
			cls: 'mp-review-row-meta',
			text: `${meta} · ${overdueText}${hint}`,
		});

		const actionsEl = row.createDiv({ cls: 'mp-review-row-actions' });

		if (item.needsChoice) {
			// 计划走完了，交给用户选：常态循环还是毕业
			actionsEl.createEl('button', {
				cls: 'mod-cta mp-btn-sm',
				text: `继续 ${ongoingIntervalOf(file)} 天`,
			}).addEventListener('click', () => {
				void persist(applyReview(file, item.path, now(), 'continue'));
			});
			actionsEl.createEl('button', {
				cls: 'mp-btn-sm',
				text: '毕业',
			}).addEventListener('click', () => {
				void persist(applyReview(file, item.path, now(), 'graduate'));
			});
		} else {
			actionsEl.createEl('button', {
				cls: 'mod-cta mp-btn-sm',
				text: '已回看',
			}).addEventListener('click', () => {
				void persist(applyReview(file, item.path, now(), 'advance'));
			});
		}

		return row;
	}

	/* ── 添加区（搜索框只创建一次，避免输入时丢焦点）─────── */

	const searchInput = addEl.createEl('input', {
		cls: 'mp-review-search',
		attr: { type: 'search', placeholder: '搜索要加入回看的笔记' },
	});
	const addActions = addEl.createDiv({ cls: 'mp-review-add-actions' });
	addActions.createEl('button', {
		cls: 'mp-btn-sm',
		text: '加入当前笔记',
	}).addEventListener('click', () => {
		void addCurrentNote();
	});
	const resultsEl = addEl.createDiv({ cls: 'mp-review-results' });

	searchInput.addEventListener('input', () => {
		search = searchInput.value;
		renderResults();
	});

	function renderResults(): void {
		resultsEl.empty();
		if (!loaded || !search.trim()) return;

		const candidates = searchCandidates(file, vaultPaths(), search);
		if (candidates.length === 0) {
			resultsEl.createDiv({ cls: 'mp-review-empty', text: '没有匹配的笔记' });
			return;
		}

		for (const candidate of candidates) {
			const row = resultsEl.createDiv({ cls: 'mp-review-result' });
			const main = row.createDiv({ cls: 'mp-review-result-main' });
			main.createDiv({ cls: 'mp-review-result-name', text: candidate.name });
			if (candidate.folder) {
				main.createDiv({ cls: 'mp-review-result-path', text: candidate.folder });
			}

			if (candidate.added) {
				row.createSpan({ cls: 'mp-review-added', text: '已加入' });
			} else {
				row.createEl('button', { cls: 'mp-btn-sm', text: '加入' }).addEventListener(
					'click',
					() => {
						void addPathsAndSave([candidate.path]);
					},
				);
			}
		}
	}

	async function addCurrentNote(): Promise<void> {
		const active = plugin.app.workspace.getActiveFile();
		if (!active || active.extension !== 'md') {
			setWarning('当前没有打开的笔记');
			return;
		}
		await addPathsAndSave([active.path]);
	}

	async function addPathsAndSave(paths: string[]): Promise<void> {
		const result = addPaths(file, paths, now());
		const names = result.added.map(basenameOf).join('、');
		const message =
			result.added.length > 0
				? `已加入：${names}（${formatDay(now())} 起算，首轮 ${file.intervals[0] ?? 1} 天后回看）`
				: '这些笔记已经在清单里了';

		await persist(result.file);
		setWarning(message, 'is-info');
	}

	function setWarning(text: string, cls?: string): void {
		warning = text;
		warningEl.empty();
		warningEl.removeClass('is-info');
		if (cls) warningEl.addClass(cls);
		warningEl.setText(text);
		warningEl.removeClass('is-hidden');
	}

	/* ── 管理区 ───────────────────────────────────────────── */

	function renderManage(): void {
		manageEl.empty();
		if (!loaded) return;

		const groups = collectManaged(file);
		const total = Object.values(file.items).length;
		if (total === 0) return;

		const body = createFold(manageEl, 'manage', `全部已加入 ${total} 篇`);
		buildGroup(body, '进行中', groups.active, 'active');
		buildGroup(body, '常态循环', groups.ongoing, 'ongoing');
		buildGroup(body, '已暂停', groups.paused, 'paused');
		buildGroup(body, '已毕业', groups.graduated, 'graduated');
		buildGroup(body, '失联', groups.missing, 'missing');
	}

	function buildGroup(
		parent: HTMLElement,
		title: string,
		items: ManagedItem[],
		kind: keyof ManagedGroups,
	): void {
		if (items.length === 0) return;

		const wrap = parent.createDiv({ cls: 'mp-review-group' });
		wrap.createDiv({ cls: 'mp-review-group-title', text: `${title} ${items.length}` });

		for (const item of items) {
			const row = wrap.createDiv({ cls: 'mp-review-manage-row' });
			const main = row.createDiv({ cls: 'mp-review-row-main' });
			const nameEl = main.createDiv({ cls: 'mp-review-row-name' });
			nameEl.setText(item.name);
			if (kind !== 'missing') {
				nameEl.addEventListener('click', () => {
					void openNote(item.path);
				});
			}
			main.createDiv({ cls: 'mp-review-row-meta', text: item.progress });

			const btns = row.createDiv({ cls: 'mp-review-row-actions' });

			if (kind === 'active' || kind === 'ongoing') {
				btns.createEl('button', { cls: 'mp-btn-sm', text: '暂停' }).addEventListener(
					'click',
					() => {
						void persist(setPaused(file, item.path, true));
					},
				);
			} else if (kind === 'paused') {
				btns.createEl('button', { cls: 'mp-btn-sm', text: '恢复' }).addEventListener(
					'click',
					() => {
						void persist(setPaused(file, item.path, false));
					},
				);
			} else if (kind === 'graduated' || kind === 'missing') {
				btns.createEl('button', { cls: 'mp-btn-sm', text: '重新开始' }).addEventListener(
					'click',
					() => {
						void persist(restartItem(file, item.path, now()));
					},
				);
			}

			btns.createEl('button', { cls: 'mp-btn-sm', text: '移除' }).addEventListener(
				'click',
				() => {
					void persist(removeItem(file, item.path));
				},
			);
		}
	}

	function createFold(parent: HTMLElement, key: string, title: string): HTMLElement {
		const fold = parent.createDiv({ cls: 'mp-fold' });
		const head = fold.createDiv({ cls: 'mp-fold-head' });
		const icon = head.createSpan({ cls: 'mp-fold-icon' });
		head.createSpan({ text: title });
		const body = fold.createDiv({ cls: 'mp-fold-body' });

		const apply = () => {
			const open = openFolds.has(key);
			icon.empty();
			setIcon(icon, open ? 'chevron-down' : 'chevron-right');
			body.toggleClass('is-hidden', !open);
			fold.toggleClass('is-open', open);
		};

		head.addEventListener('click', () => {
			if (openFolds.has(key)) openFolds.delete(key);
			else openFolds.add(key);
			apply();
		});
		apply();

		return body;
	}

	async function openNote(path: string): Promise<void> {
		// 用 openLinkText 走 Obsidian 自己的打开策略，不会挤掉侧边栏
		await plugin.app.workspace.openLinkText(path.replace(/\.md$/i, ''), '', false);
	}

	void bootstrap();
}
