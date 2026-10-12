// Two valid ASCII/text PDFs for local and hosted browser QA; no thesis/user data.
export function pdfFixture(revision = 1) {
  if (![1, 2].includes(revision)) throw new Error('invalid_pdf_fixture_revision');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', null,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const suffix = revision === 2 ? ' revisi' : '';
  for (const [i, text] of [[3, 'Bab I Pendahuluan' + suffix], [5, 'Bab III Metode validasi' + suffix]]) {
    const stream = `BT /F1 14 Tf 50 780 Td (${text}) Tj ET`;
    objs[i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = '%PDF-1.4\n';
  const offset = [0];
  for (let i = 0; i < objs.length; i++) {
    offset.push(out.length);
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offset.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
