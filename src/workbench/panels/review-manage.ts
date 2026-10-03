import type { ManagedGroups, ManagedItem } from '../../features/review';
import { formatDayKey } from '../../utils/format';
import { createCount, createFold, createNoteLink } from '../ui/controls';

export interface ManageHandlers {
	openNote(path: string): void;
	setPaused(path: string, paused: boolean): void;
	/** 重新开始会清零进度，实现里必须先确认 */
	restart(path: string, name: string): void;
	/** 移除会丢进度，实现里必须先确认 */
	remove(path: string, name: string): void;
	/** 折叠状态由调用方持有，跨重新渲染保留 */
	isFoldOpen(key: string): boolean;
	setFoldOpen(key: string, open: boolean): void;
}

type GroupKind = keyof ManagedGroups;

const FOLD_KEY = 'manage';

/** 管理区：按状态分组列出清单里的全部笔记 */
export function renderManageLists(
	parent: HTMLElement,
	groups: ManagedGroups,
	total: number,
	handlers: ManageHandlers,
): void {
	parent.empty();
	if (total === 0) return;

	const { body } = createFold(parent, {
		title: `已加入的 ${total} 篇`,
		open: handlers.isFoldOpen(FOLD_KEY),
		onToggle: (open) => handlers.setFoldOpen(FOLD_KEY, open),
	});

	buildGroup(body, '进行中', groups.active, 'active', handlers);
	buildGroup(body, '常态循环', groups.ongoing, 'ongoing', handlers);
	buildGroup(body, '已暂停', groups.paused, 'paused', handlers);
	buildGroup(body, '已毕业', groups.graduated, 'graduated', handlers);
	buildGroup(body, '失联', groups.missing, 'missing', handlers);
}

function buildGroup(
	parent: HTMLElement,
	title: string,
	items: ManagedItem[],
	kind: GroupKind,
	handlers: ManageHandlers,
): void {
	if (items.length === 0) return;

	const wrap = parent.createDiv({ cls: 'mp-group' });
	const head = wrap.createDiv({ cls: 'mp-group-title' });
	head.createSpan({ text: title });
	createCount(head, items.length, '篇');

	for (const item of items) buildManageRow(wrap, item, kind, handlers);
}

function buildManageRow(
	parent: HTMLElement,
	item: ManagedItem,
	kind: GroupKind,
	handlers: ManageHandlers,
): void {
	const row = parent.createDiv({ cls: 'mp-row is-compact' });
	const main = row.createDiv({ cls: 'mp-row-main' });

	if (kind === 'missing') {
		// 失联的笔记点不开，文件已经不在了，所以这里只能是纯文本
		main.createDiv({
			cls: 'mp-row-name is-static',
			text: item.name,
			attr: { translate: 'no' },
		});
	} else {
		createNoteLink(main, {
			name: item.name,
			path: item.path,
			onOpen: () => handlers.openNote(item.path),
		});
	}

	main.createDiv({ cls: 'mp-row-meta', text: describeProgress(item, kind) });

	const actions = row.createDiv({ cls: 'mp-row-actions' });

	if (kind === 'active' || kind === 'ongoing') {
		actions
			.createEl('button', {
				cls: 'mp-btn-sm',
				text: '暂停',
				attr: { type: 'button' },
			})
			.addEventListener('click', () => handlers.setPaused(item.path, true));
	} else if (kind === 'paused') {
		actions
			.createEl('button', {
				cls: 'mp-btn-sm',
				text: '恢复',
				attr: { type: 'button' },
			})
			.addEventListener('click', () => handlers.setPaused(item.path, false));
	} else if (kind === 'graduated' || kind === 'missing') {
		actions
			.createEl('button', {
				cls: 'mp-btn-sm',
				text: '重新开始',
				attr: { type: 'button' },
			})
			.addEventListener('click', () => handlers.restart(item.path, item.name));
	}

	actions
		.createEl('button', { cls: 'mp-btn-sm', text: '移除', attr: { type: 'button' } })
		.addEventListener('click', () => handlers.remove(item.path, item.name));
}

/**
 * 进度描述。
 * 放在面板层而不是数据层：它要跟随界面语言，数据层只产出结构化字段。
 */
function describeProgress(item: ManagedItem, kind: GroupKind): string {
	if (kind === 'graduated') return `已回看 ${item.done} 次，已毕业`;
	if (kind === 'missing') return `已回看 ${item.done} 次，笔记已失联`;
	if (kind === 'paused') return `已回看 ${item.done} 次，已暂停`;
	if (item.nextReview) {
		return `已完成 ${item.done} / ${item.total} 次，下次 ${formatDayKey(item.nextReview)}`;
	}
	return `已完成 ${item.done} / ${item.total} 次`;
}
