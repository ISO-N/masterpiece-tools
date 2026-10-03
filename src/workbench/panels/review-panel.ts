import type MasterpieceToolsPlugin from '../../main';
import type { CardActions } from '../card-types';
import {
	addPaths,
	applyReview,
	basenameOf,
	collectDue,
	collectManaged,
	createEmptyReviewFile,
	ongoingIntervalOf,
	removeItem,
	restartItem,
	searchCandidates,
	setPaused,
	todayKey,
	type ReviewFile,
} from '../../features/review';
import { debounce } from '../../utils/debounce';
import { formatDayKey } from '../../utils/format';
import { confirmAction } from '../ui/confirm';
import { createCount } from '../ui/controls';
import { renderDueList } from './review-due';
import { renderManageLists } from './review-manage';

/** 待回看列表最多铺多少行。侧边栏不是看长列表的地方，先处理最靠前的 */
const MAX_DUE_ROWS = 40;

/**
 * 搜索关键词与折叠状态放在模块作用域。
 * 工作台整体重新渲染时（例如在主搜索框里输入）面板会重新挂载，
 * 放在闭包里的话，用户敲了一半的搜索词和展开的分组每次都会被重置。
 */
let search = '';
const openFolds = new Set<string>();

/**
 * 全仓库 md 路径的短时缓存。
 *
 * 原来每敲一个字符都要 getFiles() 再 map 一遍全仓库：一万篇笔记时，
 * 每个按键都要分配一万个字符串，输入框会明显发涩。
 * 这里不需要精确失效 —— 搜索候选晚三秒才看到刚建的笔记是无感的，
 * 但每个按键卡一下是能被感知的。
 */
const PATH_CACHE_TTL = 3000;
let pathCache: { paths: string[]; at: number } | null = null;

function cachedMarkdownPaths(plugin: MasterpieceToolsPlugin): string[] {
	const now = Date.now();
	if (pathCache && now - pathCache.at < PATH_CACHE_TTL) return pathCache.paths;

	const paths = plugin.app.vault
		.getFiles()
		.filter((item) => item.extension === 'md')
		.map((item) => item.path);

	pathCache = { paths, at: now };
	return paths;
}

/** 运行结果提示。info 是操作成功，error 是需要用户处理 */
interface PanelNotice {
	text: string;
	kind: 'info' | 'error';
}

/**
 * 回看提醒面板。
 *
 * 只读仓库、只写 .masterpiece/review.json，不对任何笔记做修改。
 */
export function mountReviewPanel(container: HTMLElement, actions: CardActions): void {
	const plugin = actions.plugin;
	const root = container.createDiv({ cls: 'mp-review' });

	// role=status：让「已加入」「写入失败」这类结果被屏幕阅读器播报，
	// 否则视觉反馈对读屏用户是完全静默的
	const noticeEl = root.createDiv({
		cls: 'mp-review-notice',
		attr: { role: 'status' },
	});
	const summaryEl = root.createDiv({ cls: 'mp-review-summary' });
	const dueEl = root.createDiv({ cls: 'mp-review-due' });
	const addEl = root.createDiv({ cls: 'mp-review-add' });
	const manageEl = root.createDiv({ cls: 'mp-review-manage' });

	let file: ReviewFile = createEmptyReviewFile();
	let notice: PanelNotice | null = null;
	let loaded = false;

	/* ── 数据 ─────────────────────────────────────────────── */

	async function persist(next: ReviewFile): Promise<void> {
		file = next;
		try {
			await plugin.saveReviewData(next);
			notice = null;
		} catch (error) {
			notice = {
				text: `写入回看进度失败：${(error as Error).message}`,
				kind: 'error',
			};
		}
		render();
	}

	async function bootstrap(): Promise<void> {
		try {
			const result = await plugin.getReviewData();
			file = result.file;
			notice = result.warning ? { text: result.warning, kind: 'error' } : null;
		} catch (error) {
			// 读取失败也必须走到 loaded —— 否则面板会永远停在「读取中…」
			notice = {
				text: `回看清单读取失败：${(error as Error).message}`,
				kind: 'error',
			};
		}
		loaded = true;
		render();
	}

	/* ── 渲染 ─────────────────────────────────────────────── */

	function render(): void {
		renderNotice();
		renderSummary();
		renderDue();
		renderManage();
		renderResults();
	}

	function renderNotice(): void {
		noticeEl.empty();
		noticeEl.toggleClass('is-hidden', notice === null);
		noticeEl.removeClass('is-info', 'is-error');
		if (!notice) return;
		noticeEl.setText(notice.text);
		noticeEl.addClass(notice.kind === 'info' ? 'is-info' : 'is-error');
	}

	function renderSummary(): void {
		summaryEl.empty();

		if (!loaded) {
			summaryEl.createDiv({ cls: 'mp-summary-note', text: '读取中…' });
			return;
		}

		const groups = collectManaged(file);
		const total = Object.values(file.items).length;

		if (total === 0) {
			summaryEl.createDiv({
				cls: 'mp-summary-note',
				text: '回看清单还是空的。用下面的搜索框把要回看的笔记加进来。',
			});
			return;
		}

		const counts = summaryEl.createDiv({ cls: 'mp-review-counts' });
		createCount(counts, total, '篇在清单');
		createCount(counts, groups.active.length + groups.ongoing.length, '进行中');
		if (groups.paused.length > 0) {
			createCount(counts, groups.paused.length, '已暂停');
		}
		if (groups.graduated.length > 0) {
			createCount(counts, groups.graduated.length, '已毕业');
		}
		if (groups.missing.length > 0) {
			createCount(counts, groups.missing.length, '失联');
		}

		// 待回看为空时在这里说明；有到期时由下面的列表标题承担，不重复说两遍
		if (collectDue(file, todayKey()).length === 0) {
			summaryEl.createDiv({
				cls: 'mp-summary-note is-clear',
				text: '今天没有需要回看的笔记，到期时会出现在这里。',
			});
		}
	}

	function renderDue(): void {
		dueEl.empty();
		if (!loaded) return;

		const due = collectDue(file, todayKey());
		if (due.length === 0) return;

		const shown = due.slice(0, MAX_DUE_ROWS);

		const label = dueEl.createDiv({ cls: 'mp-section-label' });
		label.createSpan({ text: '待回看' });
		createCount(label, due.length, '篇');

		const list = dueEl.createDiv({ cls: 'mp-list' });
		renderDueList(list, shown, ongoingIntervalOf(file), {
			openNote: (path) => void openNote(path),
			advance: (path) => void advance(path),
			keepGoing: (path) => void keepGoing(path),
			graduate: (path) => void graduate(path),
		});

		if (due.length > shown.length) {
			dueEl.createDiv({
				cls: 'mp-empty',
				text: `还有 ${due.length - shown.length} 篇没列出，先处理上面这些。`,
			});
		}
	}

	function renderManage(): void {
		manageEl.empty();
		if (!loaded) return;

		renderManageLists(
			manageEl,
			collectManaged(file),
			Object.values(file.items).length,
			{
				openNote: (path) => void openNote(path),
				setPaused: (path, paused) => void persist(setPaused(file, path, paused)),
				restart: (path, name) => void restart(path, name),
				remove: (path, name) => void remove(path, name),
				isFoldOpen: (key) => openFolds.has(key),
				setFoldOpen: (key, open) => {
					if (open) openFolds.add(key);
					else openFolds.delete(key);
				},
			},
		);
	}

	/* ── 操作 ─────────────────────────────────────────────── */

	/** 确定性推进，不丢任何信息，不需要确认 */
	async function advance(path: string): Promise<void> {
		await persist(applyReview(file, path, todayKey(), 'advance'));
	}

	/** 转入常态循环，同样不丢信息 */
	async function keepGoing(path: string): Promise<void> {
		await persist(applyReview(file, path, todayKey(), 'continue'));
	}

	/** 毕业：不再安排回看，但已完成的次数保留，之后可以重新开始 */
	async function graduate(path: string): Promise<void> {
		const name = basenameOf(path);
		const confirmed = await confirmAction(plugin.app, {
			title: '结束这篇的回看计划',
			message: `「${name}」会移到「已毕业」，不再安排下次回看。已完成的次数会保留，需要时可以重新开始。`,
			confirmText: '毕业',
		});
		if (!confirmed) return;
		await persist(applyReview(file, path, todayKey(), 'graduate'));
	}

	/** 重新开始：清零完成次数，会丢进度，必须确认 */
	async function restart(path: string, name: string): Promise<void> {
		const confirmed = await confirmAction(plugin.app, {
			title: '重新开始一轮回看',
			message: `「${name}」的完成次数会归零，从第一轮重新排。笔记本身不受影响。`,
			confirmText: '重新开始',
			destructive: true,
		});
		if (!confirmed) return;
		await persist(restartItem(file, path, todayKey()));
	}

	/** 移除：删掉进度记录且无法找回，必须确认 */
	async function remove(path: string, name: string): Promise<void> {
		const confirmed = await confirmAction(plugin.app, {
			title: '从回看清单移除',
			message: `「${name}」的回看进度会被删掉，之后无法找回。笔记本身不受影响。`,
			confirmText: '移除进度',
			destructive: true,
		});
		if (!confirmed) return;
		await persist(removeItem(file, path));
	}

	async function openNote(path: string): Promise<void> {
		// 用 openLinkText 走 Obsidian 自己的打开策略，不会挤掉侧边栏
		await plugin.app.workspace.openLinkText(path.replace(/\.md$/i, ''), '', false);
	}

	/* ── 添加区（搜索框只创建一次，避免输入时丢焦点）─────── */

	const searchInput = addEl.createEl('input', {
		cls: 'mp-review-search',
		attr: {
			type: 'search',
			name: 'masterpiece-review-search',
			// 非登录字段，关掉自动填充，避免密码管理器弹出候选
			autocomplete: 'off',
			placeholder: '搜索要加入回看的笔记…',
			'aria-label': '搜索要加入回看的笔记',
		},
	});
	searchInput.value = search;

	const addActions = addEl.createDiv({ cls: 'mp-review-add-actions' });
	addActions
		.createEl('button', {
			cls: 'mp-btn-sm',
			text: '加入当前笔记',
			attr: { type: 'button' },
		})
		.addEventListener('click', () => void addCurrentNote());

	const resultsEl = addEl.createDiv({ cls: 'mp-review-results' });

	/** 防抖：中间态输入不必每次都全仓库过滤一遍 */
	const applySearch = debounce(renderResults, 120);
	searchInput.addEventListener('input', () => {
		search = searchInput.value;
		applySearch();
	});

	function renderResults(): void {
		resultsEl.empty();
		if (!loaded || !search.trim()) return;

		const candidates = searchCandidates(file, cachedMarkdownPaths(plugin), search);
		if (candidates.length === 0) {
			resultsEl.createDiv({ cls: 'mp-review-empty', text: '没有匹配的笔记' });
			return;
		}

		for (const candidate of candidates) {
			const row = resultsEl.createDiv({ cls: 'mp-review-result' });
			const main = row.createDiv({ cls: 'mp-row-main' });
			main.createDiv({
				cls: 'mp-row-name is-static',
				text: candidate.name,
				attr: { translate: 'no' },
			});
			if (candidate.folder) {
				main.createDiv({
					cls: 'mp-row-meta',
					text: candidate.folder,
					attr: { translate: 'no' },
				});
			}

			if (candidate.added) {
				row.createSpan({ cls: 'mp-review-added', text: '已加入' });
				continue;
			}

			row
				.createEl('button', {
					cls: 'mp-btn-sm',
					text: '加入',
					attr: { type: 'button' },
				})
				.addEventListener('click', () => void addPathsAndSave([candidate.path]));
		}
	}

	async function addCurrentNote(): Promise<void> {
		const active = plugin.app.workspace.getActiveFile();
		if (!active || active.extension !== 'md') {
			notice = {
				text: '当前没有打开的笔记：先打开一篇，或者在下面的搜索结果里挑',
				kind: 'error',
			};
			renderNotice();
			return;
		}
		await addPathsAndSave([active.path]);
	}

	async function addPathsAndSave(paths: string[]): Promise<void> {
		const result = addPaths(file, paths, todayKey());
		const firstInterval = file.intervals[0] ?? 1;
		await persist(result.file);

		notice =
			result.added.length > 0
				? {
						text: `已加入 ${result.added.map(basenameOf).join('、')}，从 ${formatDayKey(todayKey())} 起算，${firstInterval} 天后第一次回看`,
						kind: 'info',
					}
				: { text: '这些笔记已经在清单里了', kind: 'info' };
		renderNotice();
	}

	// bootstrap 自己吞掉异常并渲染错误提示，这里不再需要 catch
	void bootstrap();
}
