import type MasterpieceToolsPlugin from '../main';
import { generateFolderMocs } from '../features/moc';
import { updateVaultReadme } from '../features/readme';
import type { WorkbenchCard } from './card-types';
import { mountCapturePanel } from './panels/capture-panel';
import { mountChapterPanel } from './panels/chapter-panel';
import { mountReviewPanel } from './panels/review-panel';
import { mountAttachmentPanel } from './panels/attachment-panel';

export type { CardActions, CardRunResult, WorkbenchCard } from './card-types';

/**
 * 工作台卡片注册表。
 *
 * 新增功能只需要在下面追加一项，视图层无需改动：
 * - 一键式功能 → 填 `run`
 * - 需要输入框 / 选择器的功能 → 填 `render`
 */
export const WORKBENCH_CARDS: WorkbenchCard[] = [
	{
		id: 'review-reminder',
		title: '回看提醒',
		description: '按 1·1·2·3·8·15·60·90 天的间隔安排回看，只看不动你的笔记',
		icon: 'calendar-clock',
		available: true,
		keywords: ['艾宾浩斯', '复习', '回看', '间隔', 'review', 'ebbinghaus', '遗忘曲线'],
		render(container, actions) {
			mountReviewPanel(container, actions);
		},
	},
	{
		id: 'quick-capture',
		title: '快速捕获',
		description: '碎片想法零摩擦入库，可写入收集箱或当前笔记',
		icon: 'zap',
		available: true,
		keywords: ['capture', 'inbox', '收集箱', '记录', '速记', '随手记'],
		render(container, actions) {
			mountCapturePanel(container, actions);
		},
	},
	{
		id: 'update-vault-readme',
		title: '更新仓库 README',
		description: '扫描整个仓库，用「列表 + 双链」的文件树重建根目录索引',
		icon: 'folder-tree',
		available: true,
		badge: '一键运行',
		keywords: ['readme', '索引', '目录', 'index', '文件树'],
		async run(plugin: MasterpieceToolsPlugin) {
			const result = await updateVaultReadme(plugin.app, plugin.settings);
			return {
				ok: true,
				message: `已${result.created ? '创建' : '更新'} ${result.path} · ${result.folderCount} 个文件夹 / ${result.fileCount} 个文件`,
			};
		},
	},
	{
		id: 'build-moc',
		title: '生成目录 MOC',
		description: '为每个文件夹生成 _MOC.md 索引笔记，README 里的文件夹链接就指向它',
		icon: 'list-tree',
		available: true,
		badge: '一键运行',
		keywords: ['moc', '索引', '导航', 'map of content'],
		async run(plugin: MasterpieceToolsPlugin) {
			const result = await generateFolderMocs(plugin.app, plugin.settings);
			const parts = [
				`新建 ${result.created}`,
				`更新 ${result.updated}`,
				`无变化 ${result.unchanged}`,
			];
			if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length}`);
			if (result.failed.length > 0) parts.push(`失败 ${result.failed.length}`);

			if (result.failed.length > 0 || result.skipped.length > 0) {
				console.warn('[Masterpiece Tools] MOC 未能处理的文件', {
					skipped: result.skipped,
					failed: result.failed,
				});
			}

			const detail = result.failed[0]?.reason ?? '文件没有插件标记，已原样保留';
			const tail =
				result.failed.length > 0
					? `（${detail}）`
					: result.skipped.length > 0
						? '（有同名手写笔记，已跳过）'
						: '';

			return {
				ok: result.failed.length === 0,
				message: `MOC · ${parts.join(' / ')}${tail}`,
			};
		},
	},
	{
		id: 'normalize-chapter-numbering',
		title: '章节编号规范化',
		description: '把「第1章」补零成「第01章」，修正排序错乱，双链自动跟随',
		icon: 'list-ordered',
		available: true,
		badge: '先扫描',
		keywords: ['章节', '编号', '排序', '重命名', 'rename', '补零'],
		render(container, actions) {
			mountChapterPanel(container, actions);
		},
	},
	{
		id: 'orphan-attachments',
		title: '幽灵附件',
		description: '找出没有任何笔记引用的图片、PDF 等，只看不动',
		icon: 'paperclip',
		available: true,
		badge: '先扫描',
		keywords: ['附件', '图片', '素材', '清理', '孤儿', '未引用', 'attachment', 'orphan'],
		render(container, actions) {
			mountAttachmentPanel(container, actions);
		},
	},
];
