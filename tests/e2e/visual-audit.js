// Executed in the browser against rendered DOM, including alpha backgrounds and opacity.
export function auditRenderedContrast() {
  const parse = value => {
    const parts = value.match(/[\d.]+/g)?.map(Number);
    if (!parts || parts.length < 3) throw new Error(`Unsupported CSS color: ${value}`);
    return [...parts.slice(0, 3), parts[3] ?? 1];
  };
  const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
  const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const chain = element => { const result = []; for (let el = element; el; el = el.parentElement) result.unshift(el); return result; };
  const background = element => chain(element).reduce((color, el) => over(parse(getComputedStyle(el).backgroundColor), color), [255, 255, 255]);
  const painted = (element, color) => {
    for (let el = element; el; el = el.parentElement) color = over([...color, Number(getComputedStyle(el).opacity)], background(el.parentElement));
    return color;
  };
  const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
  const describe = el => `${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, '.')} ${(el.textContent || '').trim().slice(0, 45)}`;
  const texts = [...document.querySelectorAll('body *')].filter(el => visible(el) && [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) && !el.closest('button:disabled, input:disabled, select:disabled, option'));
  const failures = [];
  for (const el of texts) {
    const style = getComputedStyle(el);
    const bg = background(el);
    const value = ratio(painted(el, over(parse(style.color), bg)), painted(el, bg));
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
    if (value < (large ? 3 : 4.5)) failures.push({ element: describe(el), ratio: Number(value.toFixed(3)) });
  }
  // Check every newly interactive QR card, including selected and keyboard-focus states.
  const controls = [...document.querySelectorAll('.scan-qr-card:not(:disabled)')].filter(visible);
  const borders = controls.map(el => {
    const style = getComputedStyle(el);
    const surround = background(el.parentElement);
    return { element: describe(el), ratio: ratio(painted(el, over(parse(style.borderTopColor), surround)), painted(el.parentElement, surround)) };
  });
  return { textCount: texts.length, textFailures: failures, controlCount: controls.length, controlFailures: borders.filter(item => item.ratio < 3), minControlContrast: Math.min(...borders.map(item => item.ratio)) };
}
