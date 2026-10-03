import { App, moment } from 'obsidian';
import {
	DEFAULT_REVIEW_INTERVALS,
	DEFAULT_REVIEW_ONGOING_INTERVAL,
	REVIEW_BACKUP_PATH,
	REVIEW_DATA_DIR,
	REVIEW_DATA_PATH,
	REVIEW_FILE_VERSION,
} from '../constants';

/* ── 类型 ─────────────────────────────────────────────────── */

/**
 * active    计划内推进中
 * ongoing   计划已走完，按最后间隔常态循环
 * graduated 已毕业，不再安排
 * paused    暂停，不出现在待回看里
 * missing   文件在当前仓库里找不到，记录保留
 */
export type ReviewState = 'active' | 'ongoing' | 'graduated' | 'paused' | 'missing';

/** advance = 自动推进；continue = 按最后间隔常态循环；graduate = 毕业 */
export type ReviewChoice = 'advance' | 'continue' | 'graduate';

export interface ReviewRecord {
	/** 加入清单的日期 */
	addedOn: string;
	/** 已完成的回看次数 */
	reviews: number;
	/** 最近一次回看日期 */
	lastReviewedOn: string | null;
	/** 下次回看日期，毕业或暂停时为 null */
	nextReview: string | null;
	/** 每次回看的日期，可用于以后做复习热力图 */
	history: string[];
	state: ReviewState;
}

export interface ReviewFile {
	version: number;
	/** 间隔序列，写在文件里，用户可自行调整 */
	intervals: number[];
	/** 走完序列后的常态回看间隔（默认 180 天） */
	ongoingInterval: number;
	/** 以笔记路径为键 */
	items: Record<string, ReviewRecord>;
}

export interface LoadResult {
	file: ReviewFile;
	/** 读取或恢复过程中的提示，正常时为 null */
	warning: string | null;
}

/* ── 日期工具 ─────────────────────────────────────────────── */

export function todayKey(): string {
	return moment().format('YYYY-MM-DD');
}

export function addDays(key: string, days: number): string {
	return moment(key, 'YYYY-MM-DD').add(days, 'days').format('YYYY-MM-DD');
}

export function daysBetween(from: string, to: string): number {
	return moment(to, 'YYYY-MM-DD').diff(moment(from, 'YYYY-MM-DD'), 'days');
}

export function formatDay(key: string): string {
	return moment(key, 'YYYY-MM-DD').format('MM-DD');
}

export function basenameOf(path: string): string {
	return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/* ── 读写 ─────────────────────────────────────────────────── */

export function createEmptyReviewFile(): ReviewFile {
	return {
		version: REVIEW_FILE_VERSION,
		intervals: [...DEFAULT_REVIEW_INTERVALS],
		ongoingInterval: DEFAULT_REVIEW_ONGOING_INTERVAL,
		items: {},
	};
}

function isReviewState(value: unknown): value is ReviewState {
	return (
		value === 'active' ||
		value === 'ongoing' ||
		value === 'graduated' ||
		value === 'paused' ||
		value === 'missing'
	);
}

/** 把外部 JSON 规整成合法结构。入参是不可信数据，逐字段校验并兜底。 */
function normalizeReviewFile(input: unknown): ReviewFile {
	const source: Record<string, unknown> =
		input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

	const rawIntervals = source.intervals;
	const intervals = Array.isArray(rawIntervals)
		? rawIntervals.filter(
				(value): value is number => typeof value === 'number' && value > 0,
			)
		: [];

	const items: Record<string, ReviewRecord> = {};
	const rawItems = source.items;
	if (rawItems && typeof rawItems === 'object') {
		for (const [path, value] of Object.entries(rawItems as Record<string, unknown>)) {
			if (!value || typeof value !== 'object') continue;
			const raw = value as Record<string, unknown>;
			items[path] = {
				addedOn: typeof raw.addedOn === 'string' ? raw.addedOn : todayKey(),
				reviews:
					typeof raw.reviews === 'number' && raw.reviews >= 0 ? raw.reviews : 0,
				lastReviewedOn:
					typeof raw.lastReviewedOn === 'string' ? raw.lastReviewedOn : null,
				nextReview: typeof raw.nextReview === 'string' ? raw.nextReview : null,
				history: Array.isArray(raw.history)
					? raw.history.filter((day): day is string => typeof day === 'string')
					: [],
				state: isReviewState(raw.state) ? raw.state : 'active',
			};
		}
	}

	const rawOngoing = source.ongoingInterval;
	return {
		version: REVIEW_FILE_VERSION,
		intervals: intervals.length > 0 ? intervals : [...DEFAULT_REVIEW_INTERVALS],
		ongoingInterval:
			typeof rawOngoing === 'number' && rawOngoing > 0
				? rawOngoing
				: DEFAULT_REVIEW_ONGOING_INTERVAL,
		items,
	};
}

export async function loadReviewFile(app: App): Promise<LoadResult> {
	const adapter = app.vault.adapter;

	if (!(await adapter.exists(REVIEW_DATA_PATH))) {
		return { file: createEmptyReviewFile(), warning: null };
	}

	let raw: string;
	try {
		raw = await adapter.read(REVIEW_DATA_PATH);
	} catch (error) {
		return {
			file: createEmptyReviewFile(),
			warning: `复习进度读取失败：${(error as Error).message}`,
		};
	}

	try {
		return { file: normalizeReviewFile(JSON.parse(raw)), warning: null };
	} catch {
		// 主文件坏了先试备份，绝不直接当成空进度覆盖掉
		if (await adapter.exists(REVIEW_BACKUP_PATH)) {
			try {
				const backup = await adapter.read(REVIEW_BACKUP_PATH);
				return {
					file: normalizeReviewFile(JSON.parse(backup)),
					warning: 'review.json 无法解析，已从备份恢复',
				};
			} catch {
				// 备份也不可用，落到下面的提示
			}
		}
		return {
			file: createEmptyReviewFile(),
			warning: 'review.json 无法解析且备份不可用，请手动检查该文件后再继续',
		};
	}
}

export async function saveReviewFile(app: App, file: ReviewFile): Promise<void> {
	const adapter = app.vault.adapter;

	if (!(await adapter.exists(REVIEW_DATA_DIR))) {
		await adapter.mkdir(REVIEW_DATA_DIR);
	}

	// 写入前留一份上一版
	if (await adapter.exists(REVIEW_DATA_PATH)) {
		const previous = await adapter.read(REVIEW_DATA_PATH);
		await adapter.write(REVIEW_BACKUP_PATH, previous);
	}

	await adapter.write(REVIEW_DATA_PATH, `${JSON.stringify(file, null, '\t')}\n`);
}

/* ── 与仓库现状对齐 ───────────────────────────────────────── */

export interface ReconcileResult {
	file: ReviewFile;
	/** 自动重新关联上的笔记 */
	relinked: string[];
	/** 是否发生了改动（决定要不要回写） */
	changed: boolean;
}

/**
 * 把记录与当前仓库对齐：
 * - 文件还在 → 若之前标记失联，恢复成 active
 * - 文件不在了 → 若全库有唯一同名笔记，判定为改名并自动跟着走；否则标记失联
 *
 * 全程只改我们自己的 JSON，不动任何笔记。
 */
export function reconcileReview(app: App, file: ReviewFile): ReconcileResult {
	const mdFiles = app.vault.getFiles().filter((item) => item.extension === 'md');
	const livePaths = new Set(mdFiles.map((item) => item.path));

	const byName = new Map<string, string[]>();
	for (const item of mdFiles) {
		const bucket = byName.get(item.name);
		if (bucket) bucket.push(item.path);
		else byName.set(item.name, [item.path]);
	}

	const items: Record<string, ReviewRecord> = {};
	const relinked: string[] = [];
	let changed = false;

	for (const [path, record] of Object.entries(file.items)) {
		if (livePaths.has(path)) {
			if (record.state === 'missing') {
				items[path] = { ...record, state: 'active' };
				changed = true;
			} else {
				items[path] = record;
			}
			continue;
		}

		if (record.state === 'missing') {
			items[path] = record;
			continue;
		}

		const name = path.split('/').pop() ?? path;
		const candidates = (byName.get(name) ?? []).filter(
			(candidate) => !file.items[candidate],
		);
		const target = candidates.length === 1 ? candidates[0] : undefined;

		if (target) {
			items[target] = record;
			relinked.push(`${basenameOf(path)} → ${basenameOf(target)}`);
			changed = true;
		} else {
			items[path] = { ...record, state: 'missing' };
			changed = true;
		}
	}

	return { file: { ...file, items }, relinked, changed };
}

/* ── 业务操作 ─────────────────────────────────────────────── */

/** 是不是计划内的最后一次回看，之后需要用户在「常态」与「毕业」之间选 */
export function needsChoice(record: ReviewRecord, intervals: number[]): boolean {
	return record.reviews + 1 >= intervals.length;
}

/** 常态回看间隔；文件里没写就退回默认值 */
export function ongoingIntervalOf(file: ReviewFile): number {
	return file.ongoingInterval > 0
		? file.ongoingInterval
		: DEFAULT_REVIEW_ONGOING_INTERVAL;
}

export function addPaths(
	file: ReviewFile,
	paths: string[],
	today: string,
): { file: ReviewFile; added: string[]; skipped: string[] } {
	const items = { ...file.items };
	const added: string[] = [];
	const skipped: string[] = [];
	const first = file.intervals[0] ?? 1;

	for (const path of paths) {
		if (items[path]) {
			skipped.push(path);
			continue;
		}
		items[path] = {
			addedOn: today,
			reviews: 0,
			lastReviewedOn: null,
			nextReview: addDays(today, first),
			history: [],
			state: 'active',
		};
		added.push(path);
	}

	return { file: { ...file, items }, added, skipped };
}

/**
 * 推进一次回看。下次日期一律以「实际回看日 + 间隔」计算，
 * 所以逾期回看会自然把后面的安排顺延。
 */
export function applyReview(
	file: ReviewFile,
	path: string,
	today: string,
	choice: ReviewChoice,
): ReviewFile {
	const record = file.items[path];
	if (!record) return file;

	const reviews = record.reviews + 1;
	const base: ReviewRecord = {
		...record,
		reviews,
		lastReviewedOn: today,
		history: [...record.history, today],
	};

	if (choice === 'graduate') {
		base.state = 'graduated';
		base.nextReview = null;
	} else if (choice === 'continue' || reviews >= file.intervals.length) {
		base.state = 'ongoing';
		base.nextReview = addDays(today, ongoingIntervalOf(file));
	} else {
		base.state = 'active';
		base.nextReview = addDays(today, file.intervals[reviews] ?? ongoingIntervalOf(file));
	}

	return { ...file, items: { ...file.items, [path]: base } };
}

export function removeItem(file: ReviewFile, path: string): ReviewFile {
	const items = { ...file.items };
	delete items[path];
	return { ...file, items };
}

export function setPaused(file: ReviewFile, path: string, paused: boolean): ReviewFile {
	const record = file.items[path];
	if (!record) return file;

	const state: ReviewState = paused
		? 'paused'
		: record.reviews >= file.intervals.length
			? 'ongoing'
			: 'active';

	return { ...file, items: { ...file.items, [path]: { ...record, state } } };
}

/** 毕业或失联的笔记重新开始一轮 */
export function restartItem(file: ReviewFile, path: string, today: string): ReviewFile {
	const record = file.items[path];
	if (!record) return file;

	return {
		...file,
		items: {
			...file.items,
			[path]: {
				...record,
				reviews: 0,
				lastReviewedOn: null,
				nextReview: addDays(today, file.intervals[0] ?? 1),
				state: 'active',
			},
		},
	};
}

/* ── 视图数据 ─────────────────────────────────────────────── */

export interface DueItem {
	path: string;
	name: string;
	record: ReviewRecord;
	/** 逾期天数，0 表示今天到期 */
	overdueDays: number;
	/** 本次是第几次回看，从 1 开始 */
	round: number;
	totalRounds: number;
	needsChoice: boolean;
}

/** 只把已到期的挑出来，未到期的不进入待回看 */
export function collectDue(file: ReviewFile, today: string): DueItem[] {
	const due: DueItem[] = [];

	for (const [path, record] of Object.entries(file.items)) {
		if (record.state !== 'active' && record.state !== 'ongoing') continue;
		if (!record.nextReview) continue;
		if (record.nextReview > today) continue;

		due.push({
			path,
			name: basenameOf(path),
			record,
			overdueDays: Math.max(0, daysBetween(record.nextReview, today)),
			round: record.reviews + 1,
			totalRounds: file.intervals.length,
			needsChoice: needsChoice(record, file.intervals),
		});
	}

	due.sort((a, b) => {
		if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
		return a.name.localeCompare(b.name, 'zh-Hans-CN');
	});

	return due;
}

export interface ManagedItem {
	path: string;
	name: string;
	record: ReviewRecord;
	/** 进度文本，例如 2/8 · 下次 10-07 */
	progress: string;
}

export interface ManagedGroups {
	active: ManagedItem[];
	ongoing: ManagedItem[];
	paused: ManagedItem[];
	graduated: ManagedItem[];
	missing: ManagedItem[];
}

export function collectManaged(file: ReviewFile): ManagedGroups {
	const groups: ManagedGroups = {
		active: [],
		ongoing: [],
		paused: [],
		graduated: [],
		missing: [],
	};

	for (const [path, record] of Object.entries(file.items)) {
		const done = record.reviews;
		const progress = record.nextReview
			? `${done}/${file.intervals.length} · 下次 ${formatDay(record.nextReview)}`
			: record.state === 'graduated'
				? `${done} 次 · 已完成`
				: `${done} 次`;

		groups[record.state].push({ path, name: basenameOf(path), record, progress });
	}

	const lists: ManagedItem[][] = [
		groups.active,
		groups.ongoing,
		groups.paused,
		groups.graduated,
		groups.missing,
	];
	for (const list of lists) {
		list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
	}

	return groups;
}

/** 按关键词在仓库笔记里找候选，供加入清单用 */
export function searchCandidates(
	file: ReviewFile,
	allPaths: string[],
	query: string,
	limit = 12,
): { path: string; name: string; folder: string; added: boolean }[] {
	const keyword = query.trim().toLowerCase();
	if (!keyword) return [];

	return allPaths
		.filter((path) => path.toLowerCase().includes(keyword))
		.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
		.slice(0, limit)
		.map((path) => ({
			path,
			name: basenameOf(path),
			folder: path.split('/').slice(0, -1).join('/'),
			added: Boolean(file.items[path]),
		}));
}
