import type MasterpieceToolsPlugin from '../main';

export interface CardRunResult {
	ok: boolean;
	message: string;
}

/** 卡片内部可以调用的动作集合 */
export interface CardActions {
	plugin: MasterpieceToolsPlugin;
	/**
	 * 执行一段逻辑，并自动完成「记录到卡片状态 → 弹提示」的收尾。
	 * 自定义卡片里的按钮应当走这里，而不是直接调用业务函数。
	 */
	run(executor: () => Promise<CardRunResult>): Promise<CardRunResult | null>;
}

/**
 * 工作台卡片。两种形态二选一：
 * - 简单卡片：实现 `run`，点击整张卡片执行
 * - 自定义卡片：实现 `render`，卡片自带表单（输入框、下拉、按钮）
 *
 * 新增功能只要在 cards.ts 的 WORKBENCH_CARDS 里追加一项，视图层无需改动。
 */
export interface WorkbenchCard {
	/** 稳定 ID，同时用作运行记录的键 */
	id: string;
	/** 卡片标题 */
	title: string;
	/** 一句话说明 */
	description: string;
	/** Lucide 图标名 */
	icon: string;
	/** 是否可用，false 表示开发中 */
	available: boolean;
	/** 未运行时展示的小标签 */
	badge?: string;
	/** 参与搜索的额外关键词 */
	keywords?: string[];
	/** 简单卡片的执行逻辑 */
	run?: (plugin: MasterpieceToolsPlugin) => Promise<CardRunResult>;
	/** 自定义卡片的正文渲染 */
	render?: (container: HTMLElement, actions: CardActions) => void;
}
