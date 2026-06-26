/**
 * UI scroll helpers — confine row-follow to a local container; never scroll the window.
 */

/** Run an action and restore window scroll if something moved the document. */
export function preserveWindowScroll(action: () => void): void {
  const scrollBefore = window.scrollY;
  action();
  requestAnimationFrame(() => {
    if (Math.abs(window.scrollY - scrollBefore) > 1) {
      window.scrollTo(0, scrollBefore);
    }
  });
}

/** Center `element` inside `container` without calling scrollIntoView (which can scroll the window). */
export function scrollContainerToCenter(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
): void {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
  const target = relativeTop - container.clientHeight / 2 + element.clientHeight / 2;
  container.scrollTo({ top: Math.max(0, target), behavior });
}

/** Scroll `container` only when `element` is outside the visible area (nearest semantics). */
export function scrollContainerToNearest(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
): void {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
  const rowBottom = relativeTop + element.clientHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (relativeTop < viewTop) {
    container.scrollTo({ top: relativeTop, behavior });
  } else if (rowBottom > viewBottom) {
    container.scrollTo({ top: rowBottom - container.clientHeight, behavior });
  }
}
