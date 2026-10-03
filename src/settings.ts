import { App, PluginSettingTab, Setting } from 'obsidian';
import type MasterpieceToolsPlugin from './main';
import { DEFAULT_MOC_FILENAME, DEFAULT_README_TITLE } from './constants';

/** 单个卡片的最近一次运行记录 */
export interface CardRunRecord {
	/** 毫秒时间戳 */
	time: number;
	/** 结果摘要 */
	message: string;
	/** 是否成功 */
	ok: boolean;
}

export interface MasterpieceSettings {
	/** README 输出路径（相对仓库根目录） */
	readmePath: string;
	/** 索引文档的一级标题 */
	readmeTitle: string;
	/** MOC 文件名（不含扩展名） */
	mocFilename: string;
	/** 快速捕获的收集箱路径 */
	inboxPath: string;
	/** 快速捕获时是否给每条内容加上时间戳 */
	captureTimestamp: boolean;
	/** 排除规则，一行一个，按路径前缀匹配 */
	excludePatterns: string;
	/** 是否把非 Markdown 附件也写进索引 */
	includeAttachments: boolean;
	/** 文件夹前是否加 📁 图标 */
	folderEmoji: boolean;
	/** 生成后是否自动打开 README */
	openAfterUpdate: boolean;
	/** 各卡片最近一次运行记录 */
	lastRuns: Record<string, CardRunRecord>;
}

export const DEFAULT_SETTINGS: MasterpieceSettings = {
	readmePath: 'README.md',
	readmeTitle: DEFAULT_README_TITLE,
	mocFilename: DEFAULT_MOC_FILENAME,
	inboxPath: '收集箱.md',
	captureTimestamp: true,
	excludePatterns: '',
	includeAttachments: false,
	folderEmoji: true,
	openAfterUpdate: true,
	lastRuns: {},
};

export class MasterpieceSettingTab extends PluginSettingTab {
	plugin: MasterpieceToolsPlugin;

	constructor(app: App, plugin: MasterpieceToolsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('仓库 README').setHeading();

		new Setting(containerEl)
			.setName('输出路径')
			.setDesc('相对仓库根目录，例如 README.md 或 索引/README.md')
			.addText((text) =>
				text
					.setPlaceholder('README.md')
					.setValue(this.plugin.settings.readmePath)
					.onChange(async (value) => {
						this.plugin.settings.readmePath =
							value.trim() || DEFAULT_SETTINGS.readmePath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('索引标题')
			.setDesc('生成文档的一级标题')
			.addText((text) =>
				text
					.setPlaceholder('仓库索引')
					.setValue(this.plugin.settings.readmeTitle)
					.onChange(async (value) => {
						this.plugin.settings.readmeTitle =
							value.trim() || DEFAULT_SETTINGS.readmeTitle;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('排除的文件夹')
			.setDesc(
				'一行一个，按路径前缀匹配。以 . 开头的隐藏目录（含 Obsidian 配置目录）始终被排除。',
			)
			.addTextArea((area) => {
				area.inputEl.rows = 5;
				area
					.setPlaceholder('模板\n附件/临时')
					.setValue(this.plugin.settings.excludePatterns)
					.onChange(async (value) => {
						this.plugin.settings.excludePatterns = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('包含非 Markdown 附件')
			.setDesc('开启后图片、PDF 等文件也会出现在索引中')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeAttachments)
					.onChange(async (value) => {
						this.plugin.settings.includeAttachments = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('文件夹图标')
			.setDesc('在文件夹名称前加一个 📁')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.folderEmoji)
					.onChange(async (value) => {
						this.plugin.settings.folderEmoji = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('生成后打开 README')
			.setDesc('完成后在新标签页打开这份索引')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openAfterUpdate)
					.onChange(async (value) => {
						this.plugin.settings.openAfterUpdate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('立即生成')
			.setDesc('跳过工作台，直接按当前设置重建索引')
			.addButton((button) =>
				button.setButtonText('生成').onClick(() => {
					// 走统一入口，保证结果同样被记录到工作台卡片上
					void this.plugin.runCardById('update-vault-readme');
				}),
			);

		new Setting(containerEl).setName('MOC 索引').setHeading();

		new Setting(containerEl)
			.setName('MOC 文件名')
			.setDesc(
				'每个文件夹里生成的索引笔记名，不含扩展名。默认 _MOC，下划线开头会排在文件夹最前面',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_MOC_FILENAME)
					.setValue(this.plugin.settings.mocFilename)
					.onChange(async (value) => {
						this.plugin.settings.mocFilename =
							value.trim() || DEFAULT_MOC_FILENAME;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('手动区与自动区')
			.setDesc(
				'生成的 MOC 用 <!-- mp:auto:... --> 与 <!-- mp:manual --> 注释切分为三块：标题和链接列表由插件重写，中间的手动区永不改动。标记不完整的文件会被跳过，不会覆盖你的内容。',
			);

		new Setting(containerEl)
			.setName('立即生成 MOC')
			.setDesc('为仓库内每个文件夹生成或更新索引笔记')
			.addButton((button) =>
				button.setButtonText('生成').onClick(() => {
					void this.plugin.runCardById('build-moc');
				}),
			);

		new Setting(containerEl).setName('快速捕获').setHeading();

		new Setting(containerEl)
			.setName('收集箱路径')
			.setDesc('快速捕获默认写入的笔记，不存在时自动创建。例如 收集箱.md 或 inbox/收集箱.md')
			.addText((text) =>
				text
					.setPlaceholder('收集箱.md')
					.setValue(this.plugin.settings.inboxPath)
					.onChange(async (value) => {
						this.plugin.settings.inboxPath =
							value.trim() || DEFAULT_SETTINGS.inboxPath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('加时间戳')
			.setDesc('每条捕获内容前加上 HH:mm，方便回溯是哪个时间段记下的')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.captureTimestamp)
					.onChange(async (value) => {
						this.plugin.settings.captureTimestamp = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
