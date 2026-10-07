import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // A copy is transferred to the bundled worker. No remote OCR or CDN request.
  const task = getDocument({
    data: bytes.slice(),
    stopAtErrors: true,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}
export async function extractPdf(
  pdf: PDFDocumentProxy,
  onProgress: (n: number) => void,
) {
  if (pdf.numPages > 2000)
    throw new Error(
      "Naskah melebihi batas 2.000 halaman. Pecah naskah menjadi file yang sesuai.",
    );
  const pages: any[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const p = await pdf.getPage(page);
    const content = await p.getTextContent();
    const text = content.items
      .map((i: any) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : ""))
      .join("")
      .trim();
    pages.push({ pdf_page: page, printed_label: null, text, source: "pdfjs" });
    onProgress(page);
    p.cleanup();
  }
  return pages;
}

const tasks = new WeakMap<PDFDocumentProxy, ReturnType<typeof getDocument>>();
export async function closePdf(doc: PDFDocumentProxy) {
  await tasks.get(doc)?.destroy();
}
