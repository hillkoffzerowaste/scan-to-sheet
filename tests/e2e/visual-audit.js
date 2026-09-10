// Executed in the browser against rendered DOM, including alpha backgrounds and opacity.
export function auditRenderedContrast() {
  const parse = value => {
    const parts = value.match(/[\d.]+/g)?.map(Number);
    if (!parts || parts.length < 3) throw new Error(`Unsupported CSS color: ${value}`);
    return [...parts.slice(0, 3).map(v => value.startsWith('color(srgb') ? v * 255 : v), parts[3] ?? 1];
  };
  const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3]));
  const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const chain = element => { const result = []; for (let el = element; el; el = el.parentElement) result.unshift(el); return result; };
  const background = element => chain(element).reduce((color, el) => {
    const style = getComputedStyle(el);
    let result = over(parse(style.backgroundColor), color);
    // Existing semantic tints use two identical gradient stops over an opaque surface.
    const stops = style.backgroundImage.match(/rgba?\([^)]+\)/g);
    if (stops?.length === 2 && stops[0] === stops[1]) result = over(parse(stops[0]), result);
    return result;
  }, [255, 255, 255]);
  const painted = (element, color) => {
    for (let el = element; el; el = el.parentElement) color = over([...color, Number(getComputedStyle(el).opacity)], background(el.parentElement));
    return color;
  };
  const visible = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
  const describe = el => `${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, '.')} ${(el.textContent || '').trim().slice(0, 45)}`;
  const texts = [...document.querySelectorAll('body *')].filter(el => visible(el) && ([...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) || el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) && !el.closest('button:disabled, input:disabled, select:disabled, option'));
  const failures = [];
  for (const el of texts) {
    const style = getComputedStyle(el);
    const bg = background(el);
    const value = ratio(painted(el, over(parse(style.color), bg)), painted(el, bg));
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
    if (value < (large ? 3 : 4.5)) failures.push({ element: describe(el), ratio: Number(value.toFixed(3)) });
  }
  // Text-only navigation does not require a frame. Check its identifying text/icon,
  // while inputs, filled buttons and framed controls must have a discernible boundary.
  const controls = [...document.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type=checkbox]):not([type=radio]):not([type=file]), select:not(:disabled), textarea:not(:disabled), a.win-titlebar-btn, summary.win-titlebar-btn')].filter(visible);
  const borders = controls.map(el => {
    let frame = el;
    let style = getComputedStyle(frame);
    if (el.matches('input') && parseFloat(style.borderTopWidth) === 0 && el.closest('.scan-input-row, .win-tool-search, .staff-search, .search-input-row')) {
      frame = el.parentElement;
      style = getComputedStyle(frame);
    }
    const surround = background(frame.parentElement);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(side => parseFloat(style[`border${side}Width`]) > 0 && parse(style[`border${side}Color`])[3] > 0);
    let value;
    if (sides.length) value = Math.max(...sides.map(side => ratio(painted(frame, over(parse(style[`border${side}Color`]), surround)), painted(frame.parentElement, surround))));
    else if (el.matches('button, summary') && parse(style.backgroundColor)[3] === 0) value = ratio(over(parse(style.color), surround), surround);
    else value = ratio(background(frame), surround);
    return { element: describe(el), ratio: Number(value.toFixed(3)) };
  });
  return { textCount: texts.length, textFailures: failures, controlCount: controls.length, controlFailures: borders.filter(item => item.ratio < 3), minControlContrast: Math.min(...borders.map(item => item.ratio)) };
}
