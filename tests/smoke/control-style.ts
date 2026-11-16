export function controlStyle(element: Element) {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, color: style.color, radius: style.borderRadius, font: style.fontFamily, fontSize: style.fontSize };
}
