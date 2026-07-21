let html5QrcodePromise;

export function loadHtml5Qrcode() {
  html5QrcodePromise ??= import('html5-qrcode');
  return html5QrcodePromise;
}
