/**
 * 输入防抖。
 *
 * 用在"每敲一下都要重算一遍"的搜索框上：等手停下来再算，
 * 中间那些中间态输入没有重算的意义。
 */
export function debounce<T extends unknown[]>(
	fn: (...args: T) => void,
	wait: number,
): (...args: T) => void {
	let timer: number | null = null;

	return (...args: T): void => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			fn(...args);
		}, wait);
	};
}
