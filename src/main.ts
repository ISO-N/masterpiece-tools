import { Notice, Plugin, TFile, WorkspaceLeaf, type TAbstractFile } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MasterpieceSettings,
	MasterpieceSettingTab,
} from './settings';
import { WORKBENCH_VIEW_TYPE, WorkbenchView } from './workbench/view';
import { WORKBENCH_CARDS, type CardRunResult } from './workbench/cards';
import {
	loadReviewFile,
	reconcileReview,
	saveReviewFile,
	type LoadResult,
	type ReviewFile,
} from './features/review';

export default class MasterpieceToolsPlugin extends Plugin {
	settings!: MasterpieceSettings;

	/** 回看清单的内存缓存，首次读取后一直复用 */
	private reviewData: ReviewFile | null = null;
	private reviewWarning: string | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(
			WORKBENCH_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new WorkbenchView(leaf, this),
		);

		this.addRibbonIcon('layout-dashboard', '打开工作台', () => {
			void this.activateWorkbench();
		});

		this.addCommand({
			id: 'open-workbench',
			name: '打开工作台',
			callback: () => {
				void this.activateWorkbench();
			},
		});

		this.addCommand({
			id: 'update-vault-readme',
			name: '更新仓库 README',
			callback: () => {
				void this.runCardById('update-vault-readme');
			},
		});

		this.addCommand({
			id: 'generate-folder-mocs',
			name: '生成目录 MOC',
			callback: () => {
				void this.runCardById('build-moc');
			},
		});

		this.addSettingTab(new MasterpieceSettingTab(this.app, this));

		// 笔记改名 / 删除时同步回看清单的键，保证进度不丢（不动笔记本身）
		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				void this.followRename(file, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file: TAbstractFile) => {
				void this.markMissing(file);
			}),
		);
	}

	// 视图与事件监听的清理由 Obsidian 依据 register* 记录自动完成，无需手动 detach
	onunload() {}

	/* ── 回看清单的数据存取 ───────────────────────────────── */

	/** 读取回看清单（首次读取时与仓库现状对齐一次） */
	async getReviewData(): Promise<LoadResult> {
		if (this.reviewData) {
			return { file: this.reviewData, warning: this.reviewWarning };
		}

		const loaded = await loadReviewFile(this.app);
		const reconciled = reconcileReview(this.app, loaded.file);

		this.reviewData = reconciled.file;
		const notices: string[] = [];
		if (loaded.warning) notices.push(loaded.warning);
		if (reconciled.relinked.length > 0) {
			notices.push(`已自动跟随 ${reconciled.relinked.length} 篇改名的笔记`);
		}
		this.reviewWarning = notices.length > 0 ? notices.join('；') : null;

		if (reconciled.changed) {
			try {
				await saveReviewFile(this.app, this.reviewData);
			} catch (error) {
				console.error('[Masterpiece Tools] 回看清单回写失败', error);
			}
		}

		return { file: this.reviewData, warning: this.reviewWarning };
	}

	async saveReviewData(file: ReviewFile): Promise<void> {
		this.reviewData = file;
		this.reviewWarning = null;
		await saveReviewFile(this.app, file);
	}

	/** 改名：把记录从旧路径搬到新路径 */
	private async followRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const { file: data } = await this.getReviewData();
		const record = data.items[oldPath];
		if (!record) return;

		const items = { ...data.items };
		delete items[oldPath];
		items[file.path] = { ...record, state: 'active' };

		try {
			await this.saveReviewData({ ...data, items });
			this.refreshWorkbench();
		} catch (error) {
			console.error('[Masterpiece Tools] 跟随改名失败', error);
		}
	}

	/** 删除：只标记失联，绝不删记录 */
	private async markMissing(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== 'md') return;

		const { file: data } = await this.getReviewData();
		const record = data.items[file.path];
		if (!record || record.state === 'missing') return;

		try {
			await this.saveReviewData({
				...data,
				items: { ...data.items, [file.path]: { ...record, state: 'missing' } },
			});
			this.refreshWorkbench();
		} catch (error) {
			console.error('[Masterpiece Tools] 标记失联失败', error);
		}
	}

	/** 在右侧边栏打开工作台，已打开则直接聚焦 */
	async activateWorkbench(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice('无法打开工作台：侧边栏不可用');
			return;
		}
		await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * 按 ID 运行某个卡片。命令面板、设置面板与卡片点击都走这里，
	 * 保证「运行 → 记录 → 提示 → 刷新」的流程完全一致。
	 */
	async runCardById(id: string): Promise<CardRunResult | null> {
		const card = WORKBENCH_CARDS.find((item) => item.id === id);
		const run = card?.run;
		if (!card || !run) return null;

		const result = await this.executeCard(id, () => run(this));
		this.refreshWorkbench();
		return result;
	}

	/** 执行卡片逻辑并记录结果，异常会被转成失败结果 */
	async executeCard(
		id: string,
		run: () => Promise<CardRunResult>,
	): Promise<CardRunResult> {
		let result: CardRunResult;
		try {
			result = await run();
		} catch (error) {
			console.error('[Masterpiece Tools]', error);
			result = { ok: false, message: `运行失败：${(error as Error).message}` };
		}

		this.settings.lastRuns[id] = {
			time: Date.now(),
			message: result.message,
			ok: result.ok,
		};
		await this.saveSettings();

		if (result.ok) new Notice(result.message);
		else new Notice(result.message, 6000);

		return result;
	}

	/** 刷新所有已打开的工作台视图 */
	refreshWorkbench(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof WorkbenchView) view.render();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MasterpieceSettings>,
		);
		// 旧版本数据可能缺少字段，兜底成空对象
		if (!this.settings.lastRuns) this.settings.lastRuns = {};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
