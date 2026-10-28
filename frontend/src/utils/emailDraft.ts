import toast from 'react-hot-toast';

// Email a document with its PDF attached (Sally, 12 Oct 2026: "Can there
// be a PDF file attached ... at the moment it's all text"). A browser
// can't attach a file to a mailto link, so the POS builds the whole email
// itself — customer's address, subject, message and the PDF — as an
// unsent Outlook draft (.eml with "X-Unsent: 1") and downloads it.
// Opening it from Chrome's downloads opens Outlook's New Email window
// with everything in place, sent from that computer's Outlook account.
// Used by invoices and quotes. No server-side mail.

// UTF-8 text -> base64 (btoa only takes Latin-1).
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// An unsent email (RFC 822 / MIME) with one attachment. "X-Unsent: 1"
// makes Outlook open it as a new message ready to send rather than as a
// received one. No From header — Outlook uses that computer's account.
export function buildEml(m: {
  to: string[];
  subject: string;
  body: string;
  attachment: { name: string; type: string; base64: string };
}): string {
  const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
  const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${utf8Base64(v)}?=`);
  const boundary = `----=_ALPOS_${Date.now().toString(36)}`;
  const lines = [
    'X-Unsent: 1',
    ...(m.to.length ? [`To: ${m.to.join(', ')}`] : []),
    `Subject: ${header(m.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(utf8Base64(m.body.replace(/\r?\n/g, '\r\n'))),
    `--${boundary}`,
    `Content-Type: ${m.attachment.type}; name="${m.attachment.name}"`,
    `Content-Disposition: attachment; filename="${m.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(m.attachment.base64),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

// Builds the draft with the PDF attached, downloads it and tells the user
// where it went — the AL POS app window has no downloads button (Sally,
// 13 Oct 2026: "what steps to get this to pop up").
export async function downloadEmailDraft(m: {
  to: string;
  subject: string;
  body: string;
  pdf: Blob;
  pdfName: string;
  emlName: string;
}): Promise<void> {
  const eml = buildEml({
    to: m.to.split(/[,;\s]+/).filter(Boolean),
    subject: m.subject,
    body: m.body,
    attachment: { name: m.pdfName, type: 'application/pdf', base64: await blobToBase64(m.pdf) },
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
  a.download = m.emlName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(
    `Email ready: ${m.emlName} is in Downloads. Press Ctrl+J and click it ` +
      '(or open your Downloads folder). It opens in Outlook with the PDF attached. Check it and press Send.',
    { duration: 15000, icon: '📧' },
  );
}
